import os from 'os';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import './env.js';
import { createApp } from './app.js';
import { initDb, getDb } from './db/index.js';
import { loadConfig } from './lib/config.js';
import { applyDeclarativeConfigFromEnv } from './services/declarative-config.js';
import { loadCacheFromDb } from './services/cache.js';
import { restoreProxySettings } from './lib/proxy.js';
import { firstRunSetup } from './lib/first-run.js';
import { warnOnEnvDrift } from './lib/env-drift.js';
import { installLogRedaction } from './lib/log-redaction.js';
import {
  attachRemoteDb,
  flushRemoteDb,
  isRemoteDbConfigured,
  isRemoteDbDirty,
  restoreRemoteDb,
} from './lib/remote-db.js';

/**
 * Serverless entry point (Vercel / any Node handler runtime).
 *
 * The long-running server in `index.ts` owns sockets, timers and background
 * schedulers. None of that exists here: the platform invokes this function per
 * request, may freeze it the moment the response is written, and may run
 * several instances side by side. So this entry:
 *
 *   1. boots the same Express app exactly once per warm instance (module-scope
 *      promise, so concurrent first requests share one boot);
 *   2. restores the SQLite snapshot from Supabase Storage before opening the
 *      database, because the filesystem outside `os.tmpdir()` is read-only and
 *      `/tmp` does not survive a cold start;
 *   3. rebuilds the browser-visible path when the platform rewrote the request
 *      (`__fluzy_path`), so Express routing is identical to a self-hosted run;
 *   4. awaits the snapshot upload before returning, because anything left to a
 *      timer after the response can be frozen away.
 *
 * Everything the dashboard and the proxy do is unchanged: same routers, same
 * auth, same routing engine.
 */

installLogRedaction();

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Rewrite parameter carrying the path the browser actually requested. */
const PATH_PARAM = '__fluzy_path';

/**
 * Serverless filesystems are read-only except the temp directory, and the temp
 * directory is per instance. FLUZY_DB_PATH still wins so a mounted volume or a
 * test run can point anywhere.
 */
function resolveDbPath(): string {
  const configured = process.env.FLUZY_DB_PATH?.trim();
  if (configured) return configured;
  return path.join(os.tmpdir(), 'fluzyai', 'fluzyai.db');
}

/**
 * Rebuild the original request URL from the rewrite parameter.
 *
 * A platform rewrite hands the function its destination path, not the path the
 * browser asked for, so `/v1/chat/completions` would otherwise reach Express as
 * `/api/gateway`. The vercel.json rewrite appends the real path as
 * `__fluzy_path`, and this restores it — leaving every other query parameter
 * byte-for-byte intact (no re-encoding, no reordering). Without the parameter
 * the request is used as-is, which is what a local run or a direct function call
 * looks like.
 */
export function restoreOriginalUrl(rawUrl: string): string {
  const queryStart = rawUrl.indexOf('?');
  if (queryStart === -1) return rawUrl;

  const pathname = rawUrl.slice(0, queryStart);
  const query = rawUrl.slice(queryStart + 1);
  const parts = query.split('&');

  let restored: string | null = null;
  const kept: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    const name = eq === -1 ? part : part.slice(0, eq);
    if (name === PATH_PARAM) {
      if (restored === null) {
        const value = eq === -1 ? '' : part.slice(eq + 1);
        try {
          restored = decodeURIComponent(value);
        } catch {
          restored = value;
        }
      }
      continue;
    }
    kept.push(part);
  }

  if (!restored || !restored.startsWith('/')) return rawUrl;
  const suffix = kept.length > 0 ? `?${kept.join('&')}` : '';
  // Guard against a broken rewrite value silently rewriting the host.
  return `${restored}${suffix}` || pathname;
}

let bootPromise: Promise<{ app: Handler; dbPath: string }> | null = null;

async function boot(): Promise<{ app: Handler; dbPath: string }> {
  const config = loadConfig();
  warnOnEnvDrift();

  const dbPath = resolveDbPath();
  if (isRemoteDbConfigured()) {
    await restoreRemoteDb(dbPath);
  }

  initDb(dbPath, { ensureDir: true });

  // Attach the snapshot writer BEFORE anything writes to this database. Boot
  // itself writes — the declarative config, and the first-run account below —
  // and a write made before the hook exists never marks the file dirty, so the
  // snapshot is never uploaded and the next cold start restores nothing. (Seen
  // exactly once in production: the account existed, yet /livez still reported
  // lastUploadAt: null and the bucket stayed empty.)
  if (isRemoteDbConfigured()) {
    attachRemoteDb(getDb(), dbPath);
  }

  applyDeclarativeConfigFromEnv();
  loadCacheFromDb();
  restoreProxySettings();

  // First run on a fresh deployment. An account declared in the environment
  // (FLUZY_ADMIN_EMAIL/FLUZY_ADMIN_PASSWORD) is created here, which claims the
  // install before any request can reach it — the recommended path on Vercel,
  // where nobody can read the stdout of an instance they have not claimed yet
  // and the setup code would have to be copied into the form by hand. Without
  // it, the one-time setup code is minted (FLUZY_SETUP_CODE pins it).
  firstRunSetup();

  const app = createApp(config);

  console.log(`[serverless] ready (db: ${dbPath}${isRemoteDbConfigured() ? ', remote snapshot on' : ', local only'})`);
  return { app: app as unknown as Handler, dbPath };
}

function bootOnce(): Promise<{ app: Handler; dbPath: string }> {
  bootPromise ??= boot().catch(error => {
    // Let the next request retry a failed boot instead of caching the failure.
    bootPromise = null;
    throw error;
  });
  return bootPromise;
}

/** Runs the Express app and resolves once the response is fully written. */
function dispatch(app: Handler, req: IncomingMessage, res: ServerResponse): Promise<void> {
  return new Promise<void>(resolve => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    res.on('finish', done);
    res.on('close', done);
    try {
      app(req, res);
    } catch (error) {
      console.error('[serverless] handler threw:', error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
      }
      res.end(JSON.stringify({ error: { message: 'Internal server error', type: 'server_error' } }));
      done();
    }
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let app: Handler;
  try {
    ({ app } = await bootOnce());
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    console.error('[serverless] boot failed:', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: `Fluzy AI failed to start: ${message}`, type: 'server_error' } }));
    return;
  }

  if (typeof req.url === 'string') {
    req.url = restoreOriginalUrl(req.url);
  }

  await dispatch(app, req, res);

  // Last thing before the instance may be frozen: persist writes made by this
  // request. Failures are logged and retried on the next write, never surfaced
  // to a caller whose request already succeeded.
  if (isRemoteDbDirty()) {
    await flushRemoteDb();
  }
}
