import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { seedAdminFromEnv } from '../../lib/first-run.js';
import {
  attachRemoteDb,
  flushRemoteDb,
  isRemoteDbDirty,
  remoteDbStatus,
} from '../../lib/remote-db.js';

// Boot-time writes must be snapshotted (#regression).
//
// serverless.ts attaches the remote-db writer during boot, and boot itself
// writes: the declarative config, and the first-run account. When the writer
// was attached AFTER those, the INSERT never marked the file dirty, so the
// upload at the end of the first request was skipped: the account existed on
// that instance (and looked fine) but the bucket stayed empty, and the next
// cold start restored "absent" and asked for setup again.
//
// The tests run in order against one shared module state: the negative case (a
// write made before the hook exists) first, then the positive one.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluzyai-remote-db-'));
const dbPath = path.join(dir, 'fluzyai.db');
const realFetch = globalThis.fetch;

function stubUpload(): { calls: { url: string; method: string; size: number }[] } {
  const calls: { url: string; method: string; size: number }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      const body = init.body as Uint8Array;
      calls.push({ url, method: 'POST', size: body?.byteLength ?? 0 });
      return new Response('{}', { status: 200 });
    }
    // Restore: no snapshot yet.
    return new Response('not found', { status: 404 });
  }));
  return { calls };
}

describe('remote-db snapshotting of boot writes', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.FLUZY_REMOTE_DB_BUCKET = 'fluzyai-db';
    process.env.FLUZY_REMOTE_DB_OBJECT = 'fluzyai.db';
  });

  afterAll(() => {
    vi.stubGlobal('fetch', realFetch);
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loses a write made before the writer is attached (the bug)', async () => {
    initDb(dbPath, { ensureDir: true });
    // No attachRemoteDb yet: this INSERT is invisible to the snapshot layer.
    process.env.FLUZY_ADMIN_EMAIL = 'owner@example.com';
    process.env.FLUZY_ADMIN_PASSWORD = 'correct horse battery';
    expect(seedAdminFromEnv()).toBe('created');
    expect(isRemoteDbDirty()).toBe(false);
  });

  it('uploads the first-run account when the writer is attached first', async () => {
    const { calls } = stubUpload();
    // A second database file, so the write below is the first one on this one.
    const secondPath = path.join(dir, 'second.db');
    initDb(secondPath, { ensureDir: true });
    attachRemoteDb(getDb(), secondPath);

    // Attached first, so the boot-time INSERT is visible to the snapshot layer.
    expect(seedAdminFromEnv()).toBe('created');
    expect(isRemoteDbDirty()).toBe(true);

    expect(await flushRemoteDb()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/storage/v1/object/fluzyai-db/fluzyai.db');
    expect(calls[0].size).toBeGreaterThan(0);
    expect(remoteDbStatus().lastUploadAt).toEqual(expect.any(String));
    expect(remoteDbStatus().lastError).toBeNull();
    expect(isRemoteDbDirty()).toBe(false);
  });
});
