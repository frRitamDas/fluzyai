import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { attachRemoteDb, flushRemoteDb, remoteDbStatus } from '../../lib/remote-db.js';

// A serverless instance that is frozen mid-upload does not get an error back:
// the fetch is suspended, so the promise never settles, neither the success path
// nor the catch runs, and `inFlight` stays set for the life of the instance.
// Every later flush then short-circuits on that dead promise while the database
// keeps accepting writes — the deployment looks healthy and persists nothing.
// This is the state production reported: pendingWrite true, lastUploadAt null,
// lastError null.
//
// Two independent escapes are pinned here, because they cover different
// failures: a flush that settles by its own budget (slow network, live timers)
// and a flush that outlives its deadline (frozen instance, timers never run).

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluzyai-wedged-flush-'));
const dbPath = path.join(dir, 'fluzyai.db');
const realFetch = globalThis.fetch;

let hangUpload = false;
let uploads = 0;
let seq = 0;
const never = new Promise<Response>(() => {
  /* a fetch that was frozen with the invocation: it never settles */
});

function stubStorage(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('/storage/v1/object/')) return new Response('{}', { status: 404 });
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers: { etag: 'etag-current' } });
    }
    if (method === 'POST') {
      if (hangUpload) return never;
      uploads += 1;
      return new Response('{}', { status: 200, headers: { etag: 'etag-current' } });
    }
    return new Response(null, { status: 200, headers: { etag: 'etag-current' } });
  }));
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function write(): void {
  seq += 1;
  getDb()
    .prepare(`INSERT INTO settings (key, value) VALUES ('wedged.${seq}', '1') ON CONFLICT(key) DO NOTHING`)
    .run();
}

describe('remote-db flush that never settles', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    process.env.FLUZY_REMOTE_DB_BUCKET = 'fluzyai-db';
    process.env.FLUZY_REMOTE_DB_OBJECT = 'fluzyai.db';
    process.env.FLUZY_REMOTE_DB_UPLOAD_TIMEOUT_MS = '2000';

    initDb(dbPath, { ensureDir: true });
    attachRemoteDb(getDb(), dbPath);
    stubStorage();
  });

  afterEach(() => {
    hangUpload = false;
    delete process.env.FLUZY_REMOTE_DB_FLUSH_TIMEOUT_MS;
    delete process.env.FLUZY_REMOTE_DB_FLUSH_DEADLINE_MS;
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.stubGlobal('fetch', realFetch);
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.FLUZY_REMOTE_DB_UPLOAD_TIMEOUT_MS;
  });

  it('settles by its own budget and keeps the write pending', async () => {
    process.env.FLUZY_REMOTE_DB_FLUSH_TIMEOUT_MS = '60';
    write();

    hangUpload = true;
    expect(await flushRemoteDb()).toBe(false);

    const stuck = remoteDbStatus();
    expect(stuck.pendingWrite).toBe(true); // still owed to the bucket
    expect(stuck.flush.lastOutcome).toMatch(/timed out/);
    expect(uploads).toBe(0);

    hangUpload = false;
    expect(await flushRemoteDb()).toBe(true);
    expect(uploads).toBe(1);
    expect(remoteDbStatus().pendingWrite).toBe(false);
    expect(remoteDbStatus().flush.lastOutcome).toBe('uploaded');
  });

  it('abandons a flush that outlived its deadline instead of blocking forever', async () => {
    // A frozen instance never runs the budget timer, so the promise can outlive
    // any in-process timeout: only the next caller can notice and move on.
    process.env.FLUZY_REMOTE_DB_FLUSH_TIMEOUT_MS = '60000';
    process.env.FLUZY_REMOTE_DB_FLUSH_DEADLINE_MS = '50';
    write();

    hangUpload = true;
    void flushRemoteDb();
    await wait(150);
    expect(uploads).toBe(1); // only the earlier test's upload

    hangUpload = false;
    write(); // the instance is still serving requests
    expect(await flushRemoteDb()).toBe(true);

    const status = remoteDbStatus();
    expect(uploads).toBe(2);
    expect(status.flush.abandoned).toBe(1);
    expect(status.flush.lastOutcome).toBe('uploaded');
    expect(status.pendingWrite).toBe(false);
    expect(status.lastUploadAt).toEqual(expect.any(String));
    // The retry must not be mistaken for another instance's write.
    expect(status.staleSince).toBeNull();
  });
});
