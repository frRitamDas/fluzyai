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

/**
 * Upload timeout, deliberately shorter than the response hold in
 * server/src/serverless.ts (8 s).
 *
 * A 430 KB object to Supabase Storage normally lands in well under a second.
 * Letting one attempt run for 30 s meant the hold expired first, the response
 * went out, the invocation was frozen, and the in-flight upload died with
 * "The operation was aborted due to timeout" — the database silently kept the
 * change locally and the next cold start never saw it. Failing fast keeps the
 * upload inside the window where the instance is guaranteed to still be
 * running, and the dirty flag survives for the next request to retry.
 */
function uploadTimeoutMs(): number {
  const raw = Number.parseInt(process.env.FLUZY_REMOTE_DB_UPLOAD_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 3_500;
}
const UPLOAD_DEBOUNCE_MS = 1_500;

/**
 * How long one flush may stay unsettled before the next one ignores it.
 *
 * A flush runs inside the invocation that triggered it, so a platform that
 * freezes the instance mid-request (Vercel does, the moment the response is
 * written) suspends the in-flight fetch instead of failing it: the promise never
 * settles, neither the success path nor the catch runs, and `inFlight` stays set
 * for the life of the instance. Every later flush then short-circuits on that
 * dead promise and the deployment stops persisting *silently* — health output
 * showed `pendingWrite: true`, `lastUploadAt: null`, `lastError: null`, which is
 * exactly "the change is on this instance and nowhere else". Treating a flush
 * that has outlived its budget as abandoned restores the retry.
 */
function flushDeadlineMs(): number {
  const raw = Number.parseInt(process.env.FLUZY_REMOTE_DB_FLUSH_DEADLINE_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
}

/**
 * Total wall-clock budget for one flush. A frozen fetch never fires its own
 * AbortSignal timeout — timers do not run while the instance is suspended — so
 * the flush needs a settle-by deadline of its own that is shorter than the
 * response hold, or the caller waits on a promise the platform will never
 * resume. Derived from the per-call budget so tuning one knob keeps them in
 * proportion: a pre-upload HEAD, the content check, two upload attempts and the
 * post-upload HEAD.
 */
function flushTimeoutMs(): number {
  const raw = Number.parseInt(process.env.FLUZY_REMOTE_DB_FLUSH_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return Math.max(6_000, uploadTimeoutMs() * 2 + 2_000);
}

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
    knownEtag = normalizeEtag(res.headers.get('etag'));
    staleSince = null;

    const body = Buffer.from(await res.arrayBuffer());
    knownContentHash = crypto.createHash('sha256').update(body).digest('hex');
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

// Identity of the remote object as this instance last saw it. A serverless
// platform runs several instances of the same deployment, each with its own
// copy of the file: without this, an instance that restored an old snapshot and
// then uploaded would erase everything a sibling instance had written since —
// which reached production as "the API key I added disappears". Before each
// upload we compare the remote ETag against the one we last observed; if it
// moved, somebody else wrote and this instance must NOT overwrite them.
let knownEtag: string | null = null;
let staleSince: string | null = null;
// SHA-256 of the bytes this instance last restored or uploaded. When the ETag
// looks foreign, the content settles it: an ETag that merely changed shape (a
// different quoting, a storage-side re-encode) must not be mistaken for another
// writer, or the guard would stop a healthy deployment from persisting at all.
let knownContentHash: string | null = null;
// When the current in-flight flush started, so a promise that outlived its
// budget can be abandoned instead of blocking every later attempt.
let inFlightStartedAt = 0;

// Why an upload did or did not happen. "Never uploaded" used to look identical
// from the outside whether nothing had changed or the instance was wedged, so
// the last outcome is recorded and exposed next to the rest of the state.
let flushAttempts = 0;
let flushUploads = 0;
let flushAbandoned = 0;
let lastFlushAt: string | null = null;
let lastFlushOutcome: string | null = null;

export interface RemoteDbStatus {
  configured: boolean;
  bucket: string | null;
  object: string | null;
  lastRestore: RestoreResult | null;
  lastRestoreAt: string | null;
  lastUploadAt: string | null;
  pendingWrite: boolean;
  lastError: string | null;
  /** Set when another instance wrote a newer snapshot than this one holds. */
  staleSince: string | null;
  /** Upload bookkeeping, so "nothing to upload" is distinguishable from "stuck". */
  flush: {
    attempts: number;
    uploads: number;
    abandoned: number;
    lastAttemptAt: string | null;
    lastOutcome: string | null;
  };
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
    staleSince,
    flush: {
      attempts: flushAttempts,
      uploads: flushUploads,
      abandoned: flushAbandoned,
      lastAttemptAt: lastFlushAt,
      lastOutcome: lastFlushOutcome,
    },
  };
}

/** The remote object's ETag, or null when the storage API does not send one. */
/** Storage ETags arrive quoted on some responses and bare on others. */
function normalizeEtag(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  return trimmed.length > 0 ? trimmed : null;
}

async function remoteEtagFor(config: RemoteDbConfig): Promise<string | null> {
  try {
    const res = await fetch(objectUrl(config), {
      method: 'HEAD',
      headers: authHeaders(config),
      // Same budget as the upload. The guard runs while a response is being
      // held open for the snapshot, so a HEAD that may take 30 s can outlive the
      // hold on its own — the response goes out, the instance freezes, and the
      // upload it was guarding never happens. A HEAD this slow is a broken
      // connection, not evidence about the object: treat it as "unknown".
      signal: AbortSignal.timeout(uploadTimeoutMs()),
    });
    if (!res.ok) return null;
    return normalizeEtag(res.headers.get('etag'));
  } catch {
    // A HEAD that fails must not block the upload: the ETag guard is a
    // safety net, and losing it is better than never persisting at all.
    return null;
  }
}

/** Kill switch for the stale-instance guard (FLUZY_REMOTE_DB_STALE_GUARD=0). */
function staleGuardEnabled(): boolean {
  const raw = (process.env.FLUZY_REMOTE_DB_STALE_GUARD ?? '').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off');
}

/** SHA-256 of the bytes currently stored remotely, or null if unavailable. */
async function remoteContentHash(config: RemoteDbConfig): Promise<string | null> {
  try {
    const res = await fetch(objectUrl(config), {
      headers: authHeaders(config),
      // Bounded like the HEAD above: this downloads the whole snapshot, so it
      // must fit inside the response hold too.
      signal: AbortSignal.timeout(uploadTimeoutMs()),
    });
    if (!res.ok) return null;
    const body = Buffer.from(await res.arrayBuffer());
    return crypto.createHash('sha256').update(body).digest('hex');
  } catch {
    return null;
  }
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
  if (inFlight) {
    if (Date.now() - inFlightStartedAt < flushDeadlineMs()) return inFlight;
    // The previous attempt is not slow, it is gone: the instance was frozen
    // with the request still open and the promise will never settle. Ignore it
    // and try again, or this instance silently stops persisting for good.
    flushAbandoned += 1;
    console.warn(
      '[remote-db] previous snapshot upload never settled (instance was frozen mid-flight); retrying',
    );
    inFlight = null;
  }
  const config = remoteDbConfig();
  if (!config || !dirty || !localDbPath) return false;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  const pathAtStart = localDbPath;
  dirty = false;
  flushAttempts += 1;
  lastFlushAt = new Date().toISOString();
  const work = (async (): Promise<boolean> => {
    try {
      if (localDb) checkpoint(localDb);
      const body = fs.readFileSync(pathAtStart);

      // Refuse to overwrite a snapshot another instance wrote after us. One
      // cheap HEAD, and only when we know the ETag from a restore/upload — with
      // no baseline there is nothing to compare against.
      if (knownEtag && staleGuardEnabled()) {
        const remoteEtag = await remoteEtagFor(config);
        if (remoteEtag && remoteEtag !== knownEtag) {
          // Suspicious, not decisive: confirm against the bytes. Equal content
          // means the ETag moved for a reason that is not a competing writer.
          const remoteHash = await remoteContentHash(config);
          if (remoteHash && knownContentHash && remoteHash === knownContentHash) {
            knownEtag = remoteEtag;
          } else {
            staleSince = new Date().toISOString();
            lastError = 'another instance wrote a newer snapshot';
            lastFlushOutcome = 'stale';
            dirty = false; // uploading would destroy their write; stop trying
            console.warn(
              '[remote-db] skipping upload: another instance wrote a newer snapshot. ' +
                'This instance is serving a stale copy and needs a cold start to resync.',
            );
            return false;
          }
        }
      }
      // Content, not mtime: the WAL checkpoint above rewrites the file's
      // timestamps even when it folds nothing in, so an mtime comparison made
      // every flush look dirty and uploaded the same bytes twice per request.
      const hash = crypto.createHash('sha256').update(body).digest('hex');
      if (lastUploaded && lastUploaded.size === body.length && lastUploaded.hash === hash) {
        lastFlushOutcome = 'unchanged';
        return false;
      }
      // One immediate retry: a cold TLS handshake to the storage host is the
      // single most common way the first attempt loses its 5 s budget, and a
      // second attempt reuses the connection.
      let res: globalThis.Response | null = null;
      let lastFailure = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        res = await fetch(objectUrl(config), {
          method: 'POST',
          headers: authHeaders(config, {
            'content-type': 'application/octet-stream',
            'cache-control': 'no-store',
            'x-upsert': 'true',
          }),
          body,
          signal: AbortSignal.timeout(uploadTimeoutMs()),
        });
        if (res.ok) break;
        lastFailure = `HTTP ${res.status} ${res.statusText}${(await res.text().catch(() => '')).slice(0, 200)}`;
      }
      if (!res || !res.ok) {
        throw new Error(lastFailure || 'upload failed');
      }
      lastUploaded = { size: body.length, hash };
      knownContentHash = hash;
      lastUploadAt = new Date().toISOString();
      lastError = null;
      staleSince = null;
      flushUploads += 1;
      lastFlushOutcome = 'uploaded';
      // Re-read the ETag rather than trusting the upload response: the value
      // must come from the same endpoint (and same quoting) the next comparison
      // uses, or every upload after the first would look like a foreign write.
      knownEtag = (await remoteEtagFor(config)) ?? knownEtag;
      console.log(`[remote-db] uploaded ${(body.length / 1024).toFixed(1)} KB to ${config.bucket}/${config.object}`);
      return true;
    } catch (error) {
      // Keep the dirty flag so the next write (or request) retries the upload.
      dirty = true;
      lastError = (error as Error)?.message ?? String(error);
      lastFlushOutcome = `failed: ${lastError}`;
      console.warn(`[remote-db] upload failed: ${lastError}`);
      return false;
    }
  })();

  // Settle by the deadline even if a fetch below is suspended by the platform.
  // The work keeps running in the background and, if it does finish, still
  // records the upload; the caller is simply not left holding the response open
  // for a promise that may never be resumed.
  const budget = flushTimeoutMs();
  const attempt = (async (): Promise<boolean> => {
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<boolean>(resolve => {
      timer = setTimeout(() => {
        lastFlushOutcome = `timed out after ${budget} ms`;
        // Nothing was confirmed: keep the change pending so the next request
        // (or write) retries it instead of treating it as saved.
        dirty = true;
        console.warn(`[remote-db] snapshot upload exceeded ${budget} ms; retrying on the next request`);
        resolve(false);
      }, budget);
      timer.unref?.();
    });
    try {
      return await Promise.race([work, guard]);
    } finally {
      // The work may still be running (that is the point of the race), but a
      // timer that fires afterwards would mark a saved database dirty again.
      if (timer) clearTimeout(timer);
    }
  })();

  inFlight = attempt;
  inFlightStartedAt = Date.now();
  // Clear only our own attempt: an abandoned promise may settle later, and it
  // must not wipe out the retry that replaced it.
  const clear = (): void => {
    if (inFlight === attempt) inFlight = null;
  };
  attempt.then(clear, clear);
  return attempt;
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
