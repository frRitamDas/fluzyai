import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Db } from '../db/types.js';

/**
 * Remote persistence for the SQLite database on ephemeral hosts.
 *
 * Fluzy AI stores everything in one SQLite file. That is ideal on a laptop, a
 * VPS or in Docker, and impossible on a serverless platform: the only writable
 * path is `/tmp`, and it belongs to one warm instance and disappears with it.
 * This module keeps the same SQLite code path and adds a durable copy of that
 * file in Supabase Storage:
 *
 *   boot      → download the newest snapshot into the local DB path
 *   writes    → mark the database dirty
 *   response  → the platform adapter (server/src/serverless.ts) awaits
 *               flushRemoteDb() before it returns, so an upload is never
 *               abandoned when the instance is frozen
 *   shutdown  → best-effort flush when the process gets a termination signal
 *
 * Object-level snapshots are a deliberate trade: the alternative (porting ~50
 * migrations and every query to Postgres) would rewrite the data layer, while
 * last-write-wins snapshots keep one code path for every deployment target.
 * Concurrent instances can therefore overwrite each other's snapshot; run one
 * instance (the serverless default) or use the self-hosted server for
 * multi-writer workloads.
 *
 * Configuration (all optional — without it the DB is simply local, which is
 * what self-hosted installs want):
 *   SUPABASE_URL / FLUZY_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY / FLUZY_SUPABASE_SERVICE_ROLE_KEY
 *   FLUZY_REMOTE_DB_BUCKET   (default: fluzyai-db)
 *   FLUZY_REMOTE_DB_OBJECT   (default: fluzyai.db)
 *   FLUZY_REMOTE_DB=0        (disable even when the credentials are present)
 */

const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_DEBOUNCE_MS = 1_500;

export interface RemoteDbConfig {
  url: string;
  key: string;
  bucket: string;
  object: string;
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Resolved remote-storage config, or null when snapshots are not configured. */
export function remoteDbConfig(): RemoteDbConfig | null {
  const toggle = (process.env.FLUZY_REMOTE_DB ?? '').trim().toLowerCase();
  if (toggle === '0' || toggle === 'off' || toggle === 'false' || toggle === 'no') return null;

  const url = firstEnv('SUPABASE_URL', 'FLUZY_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const key = firstEnv(
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'FLUZY_SUPABASE_SERVICE_ROLE_KEY',
  );
  if (!url || !key) return null;

  return {
    url: url.replace(/\/+$/, ''),
    key,
    bucket: firstEnv('FLUZY_REMOTE_DB_BUCKET') ?? 'fluzyai-db',
    object: (firstEnv('FLUZY_REMOTE_DB_OBJECT') ?? 'fluzyai.db').replace(/^\/+/, ''),
  };
}

export function isRemoteDbConfigured(): boolean {
  return remoteDbConfig() !== null;
}

function objectUrl(config: RemoteDbConfig): string {
  const bucket = encodeURIComponent(config.bucket);
  const object = config.object.split('/').map(encodeURIComponent).join('/');
  return `${config.url}/storage/v1/object/${bucket}/${object}`;
}

function authHeaders(config: RemoteDbConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    ...extra,
  };
}

export type RestoreResult = 'restored' | 'absent' | 'disabled' | 'failed';

/**
 * Download the remote snapshot to `dbPath` (plus its WAL sidecars, which the
 * upload clears before writing). Runs BEFORE the database is opened: replacing
 * the file under an open connection would corrupt the instance.
 */
export async function restoreRemoteDb(dbPath: string): Promise<RestoreResult> {
  const config = remoteDbConfig();
  if (!config) return 'disabled';
  lastRestoreAt = new Date().toISOString();
  const result = await restoreRemoteDbInner(config, dbPath);
  lastRestoreResult = result;
  return result;
}

async function restoreRemoteDbInner(config: RemoteDbConfig, dbPath: string): Promise<RestoreResult> {

  try {
    const res = await fetch(objectUrl(config), {
      headers: authHeaders(config),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 404 || res.status === 400) {
      // No snapshot yet (first boot) or the bucket is missing.
      console.log(`[remote-db] no snapshot at ${config.bucket}/${config.object} — starting empty`);
      return 'absent';
    }
    if (!res.ok) {
      console.warn(`[remote-db] restore failed: HTTP ${res.status} ${res.statusText}`);
      return 'failed';
    }

    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0) {
      console.warn('[remote-db] snapshot is empty — starting empty');
      return 'absent';
    }

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const tmpPath = `${dbPath}.restore-${process.pid}`;
    fs.writeFileSync(tmpPath, body);
    // A stale -wal/-shm beside a replaced main file makes SQLite replay a log
    // that belongs to the old database, so they are removed together.
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
      } catch {
        /* nothing to remove */
      }
    }
    fs.renameSync(tmpPath, dbPath);
    console.log(`[remote-db] restored ${(body.length / 1024).toFixed(1)} KB from ${config.bucket}/${config.object}`);
    return 'restored';
  } catch (error) {
    console.warn(`[remote-db] restore failed: ${(error as Error)?.message ?? error}`);
    return 'failed';
  }
}

let localDbPath: string | null = null;
let localDb: Db | null = null;
let dirty = false;
let inFlight: Promise<boolean> | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
/** Size + mtime of the last uploaded file, so a write that changed nothing
 *  (a session touch, a no-op UPDATE) does not cost another upload. */
let lastUploaded: { size: number; hash: string } | null = null;

// Observed state, surfaced by GET /livez so an operator can tell "persistence is
// configured and working" apart from "this instance is about to forget
// everything". Nothing here is a secret: bucket and object names only.
let lastRestoreResult: RestoreResult | null = null;
let lastRestoreAt: string | null = null;
let lastUploadAt: string | null = null;
let lastError: string | null = null;

export interface RemoteDbStatus {
  configured: boolean;
  bucket: string | null;
  object: string | null;
  lastRestore: RestoreResult | null;
  lastRestoreAt: string | null;
  lastUploadAt: string | null;
  pendingWrite: boolean;
  lastError: string | null;
}

export function remoteDbStatus(): RemoteDbStatus {
  const config = remoteDbConfig();
  return {
    configured: config !== null,
    bucket: config?.bucket ?? null,
    object: config?.object ?? null,
    lastRestore: lastRestoreResult,
    lastRestoreAt,
    lastUploadAt,
    pendingWrite: dirty,
    lastError,
  };
}

function checkpoint(db: Db): void {
  try {
    // Fold the WAL back into the main file so the uploaded bytes are complete.
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* driver without pragma support, or a read-only handle: upload as-is */
  }
}

/** Upload the current database file to the remote bucket. */
export async function flushRemoteDb(): Promise<boolean> {
  if (inFlight) return inFlight;
  const config = remoteDbConfig();
  if (!config || !dirty || !localDbPath) return false;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  const pathAtStart = localDbPath;
  dirty = false;
  inFlight = (async () => {
    try {
      if (localDb) checkpoint(localDb);
      const body = fs.readFileSync(pathAtStart);
      // Content, not mtime: the WAL checkpoint above rewrites the file's
      // timestamps even when it folds nothing in, so an mtime comparison made
      // every flush look dirty and uploaded the same bytes twice per request.
      const hash = crypto.createHash('sha256').update(body).digest('hex');
      if (lastUploaded && lastUploaded.size === body.length && lastUploaded.hash === hash) {
        return false;
      }
      const res = await fetch(objectUrl(config), {
        method: 'POST',
        headers: authHeaders(config, {
          'content-type': 'application/octet-stream',
          'cache-control': 'no-store',
          'x-upsert': 'true',
        }),
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
      }
      lastUploaded = { size: body.length, hash };
      lastUploadAt = new Date().toISOString();
      lastError = null;
      console.log(`[remote-db] uploaded ${(body.length / 1024).toFixed(1)} KB to ${config.bucket}/${config.object}`);
      return true;
    } catch (error) {
      // Keep the dirty flag so the next write (or request) retries the upload.
      dirty = true;
      lastError = (error as Error)?.message ?? String(error);
      console.warn(`[remote-db] upload failed: ${lastError}`);
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function scheduleFlush(): void {
  if (debounceTimer || !remoteDbConfig()) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushRemoteDb();
  }, UPLOAD_DEBOUNCE_MS);
  // Never hold the event loop open for a snapshot.
  debounceTimer.unref?.();
}

/**
 * Wrap a Db so every write marks the snapshot dirty, and register the local
 * path so flushRemoteDb() knows which file to upload.
 */
export function attachRemoteDb(db: Db, dbPath: string): void {
  if (!remoteDbConfig()) return;
  localDb = db;
  localDbPath = dbPath;

  const markDirty = (): void => {
    dirty = true;
    scheduleFlush();
  };

  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    const statement = originalPrepare(sql);
    return {
      get: (...params: unknown[]) => statement.get(...params),
      all: (...params: unknown[]) => statement.all(...params),
      run: (...params: unknown[]) => {
        const result = statement.run(...params);
        markDirty();
        return result;
      },
    };
  };

  const originalExec = db.exec.bind(db);
  db.exec = (sql: string) => {
    originalExec(sql);
    markDirty();
  };

  // A final attempt on shutdown; serverless hosts usually freeze instead of
  // signalling, which is why the request path awaits the flush itself.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void flushRemoteDb();
    });
  }
}

/** True when a write is waiting to be uploaded. */
export function isRemoteDbDirty(): boolean {
  return dirty;
}
