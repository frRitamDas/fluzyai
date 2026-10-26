import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { attachRemoteDb, flushRemoteDb, remoteDbStatus, restoreRemoteDb } from '../../lib/remote-db.js';

// Two warm instances of the same deployment is the normal state of a serverless
// host, and each holds its own copy of the SQLite file. The failure that reached
// production was: instance A restores the snapshot, serves for a while, and
// uploads its copy; instance B, still on an older copy, uploads later and erases
// everything A wrote — seen by the operator as "the API key I added disappears".
//
// The guard is an ETag comparison: a copy that was not the last writer must not
// become the next one. These tests pin both halves of that rule.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluzyai-stale-instance-'));
const dbPath = path.join(dir, 'fluzyai.db');
const snapshot = path.join(dir, 'snapshot.db');
const realFetch = globalThis.fetch;

const uploads: string[] = [];
let remoteEtag = 'etag-v1';
let remoteBody: Uint8Array | null = null;

function stubStorage(): void {
  uploads.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('/storage/v1/object/')) return new Response('{}', { status: 404 });
    const method = init?.method ?? 'GET';

    if (method === 'HEAD') {
      return new Response(null, {
        status: remoteBody ? 200 : 404,
        headers: remoteBody ? { etag: remoteEtag } : undefined,
      });
    }
    if (method === 'POST') {
      uploads.push(remoteEtag);
      // The storage server assigns a new ETag to the object it just wrote.
      remoteEtag = `etag-${uploads.length + 1}`;
      return new Response('{}', { status: 200, headers: { etag: remoteEtag } });
    }
    // GET: the restore path.
    if (!remoteBody) return new Response('not found', { status: 404 });
    return new Response(remoteBody, { status: 200, headers: { etag: remoteEtag } });
  }));
}

describe('remote-db stale-instance guard', () => {
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

  it('uploads when the remote has not moved since this instance restored it', async () => {
    initDb(dbPath, { ensureDir: true });
    // Make a snapshot the "other instances" will share.
    getDb().exec("INSERT INTO settings (key, value) VALUES ('test.seed', '1') ON CONFLICT(key) DO NOTHING");
    remoteBody = fs.readFileSync(dbPath);
    remoteEtag = 'etag-v1';
    stubStorage();

    expect(await restoreRemoteDb(snapshot)).toBe('restored');
    initDb(snapshot, { ensureDir: true });
    attachRemoteDb(getDb(), snapshot);

    getDb().prepare("INSERT INTO settings (key, value) VALUES ('test.a', '1') ON CONFLICT(key) DO NOTHING").run();
    expect(await flushRemoteDb()).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(remoteDbStatus().lastError).toBeNull();
    expect(remoteDbStatus().staleSince).toBeNull();
  });

  it('refuses to overwrite a snapshot another instance wrote', async () => {
    // Somebody else wrote after our last sync.
    remoteEtag = 'etag-foreign';
    getDb().prepare("INSERT INTO settings (key, value) VALUES ('test.b', '1') ON CONFLICT(key) DO NOTHING").run();

    expect(await flushRemoteDb()).toBe(false);
    expect(uploads).toHaveLength(1); // still only the first test's upload
    expect(remoteDbStatus().staleSince).toEqual(expect.any(String));
    expect(remoteDbStatus().lastError).toMatch(/another instance/i);
    // The upload was abandoned deliberately, not queued: retrying would destroy
    // the sibling's write.
    expect(remoteDbStatus().pendingWrite).toBe(false);
  });
});
