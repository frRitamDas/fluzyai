**English**

# Deploy on Vercel

Fluzy AI is a long-running Node server with a SQLite database. Vercel runs
stateless functions on a read-only filesystem, so the deployment uses a small
adapter rather than a rewrite of the app:

| Concern | Self-hosted / Docker | Vercel |
| --- | --- | --- |
| HTTP entry | `server/src/index.ts` — `app.listen()` | `api/index.mjs` → `server/src/serverless.ts` — one function per request |
| Dashboard assets | Express `express.static` + SPA fallback | CDN (`outputDirectory: client/dist`), `FLUZY_SERVE_STATIC=0` |
| Database file | `server/data/fluzyai.db` | `/tmp/fluzyai/fluzyai.db`, restored/uploaded through Supabase Storage |
| SQLite driver | `better-sqlite3` | built-in `node:sqlite` (`FLUZY_DB_DRIVER=node`) |
| Background schedulers | health checks, catalog sync, backups | not started — the platform calls in per request |
| First dashboard account | created in the browser | declared with `FLUZY_ADMIN_EMAIL` + `FLUZY_ADMIN_PASSWORD` at boot (or the `FLUZY_SETUP_CODE` fallback) |

Every router, middleware, auth rule and routing decision is the same code the
self-hosted server runs; the adapter only decides where the bytes live.

## What gets deployed

- `vercel.json` — build command, static output, and the rewrites that send
  `/api/*`, `/v1*`, `/v1beta/*`, `/mcp*`, `/livez` and `/readyz` to the function.
  The rewrite carries the browser's real path in `__fluzy_path`; the handler
  puts it back before Express routes the request.
- `api/index.mjs` — the function entry, importing the pre-bundled server.
- `scripts/build-vercel.mjs` — `npm run vercel-build`: compiles the server,
  builds the dashboard, and bundles the server into
  `server/dist/serverless-bundle.mjs` (only `better-sqlite3` and `sharp` stay
  external).
- `server/src/serverless.ts` — boot-once logic, path restoration, and the
  "upload the database before the instance is frozen" rule.
- `server/src/lib/remote-db.ts` — Supabase Storage restore/upload.

## 1. Supabase: one private bucket

Create a **private** Storage bucket (SQL, or Dashboard → Storage → New bucket):

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('fluzyai-db', 'fluzyai-db', false, 52428800)
on conflict (id) do nothing;
```

Fluzy AI writes a single object (`fluzyai.db`) with the service-role key, so no
Storage policies are needed — the key bypasses RLS. Do **not** make the bucket
public: the file holds AES-GCM-encrypted provider keys, the dashboard password
hash, and the session table.

## 2. Vercel: environment variables

Import the repository as a project (framework preset: **Other**, no root
directory), then set these for Production *and* Preview:

| Variable | Value | Why |
| --- | --- | --- |
| `ENCRYPTION_KEY` | 64 hex chars (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) | Encrypts provider keys. **Required in production.** Losing it makes stored keys unreadable. |
| `FLUZY_ADMIN_EMAIL` | your email | With the password below, creates the dashboard account at boot — the install is claimed before the first request, so there is no setup form and no code to copy. |
| `FLUZY_ADMIN_PASSWORD` | ≥ 8 characters you choose | Password for `FLUZY_ADMIN_EMAIL`. Hashed at rest, never logged; an existing account is never overwritten. |
| `FLUZY_SETUP_CODE` | ≥ 8 characters you choose | Fallback only (no `FLUZY_ADMIN_*` set): the code the first-run form asks for when the account is created from a remote browser. |
| `FLUZY_DB_PATH` | `/tmp/fluzyai/fluzyai.db` | Only writable path on a function. |
| `FLUZY_DB_DRIVER` | `node` | Uses `node:sqlite`; no native module to compile. |
| `FLUZY_SERVE_STATIC` | `0` | The CDN serves `client/dist`. |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | Snapshot storage. |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key | Snapshot storage (server-side only). |
| `FLUZY_REMOTE_DB_BUCKET` | `fluzyai-db` | Bucket from step 1. |
| `TRUST_PROXY` | `1` | Rate limits and the setup-code check then see the real client IP. |
| `CATALOG_SYNC_DISABLED` | `1` | The signed catalog is fetched from a host this deployment does not run; the bundled catalog is complete. |

`FLUZY_DB_DRIVER` defaults to `auto`, which prefers `better-sqlite3` and falls
back to `node:sqlite`. On Vercel the explicit `node` is recommended: Node 24
exposes `node:sqlite` without a flag, so the build never has to compile a native
addon.

## 3. Deploy

```bash
git push origin main        # or connect the project in the Vercel dashboard
```

Vercel runs `npm run vercel-build` → `scripts/build-vercel.mjs`, then packages
`api/index.mjs` and serves `client/dist`. If the project is named `fluzyaiorg`
the deployment answers on `https://fluzyaiorg.vercel.app`.

Then:

1. Open the deployment URL. With `FLUZY_ADMIN_EMAIL` and `FLUZY_ADMIN_PASSWORD`
   set the account already exists and the dashboard asks you to **sign in**.
   Without them, the first-run form asks for an email, a password and — because
   the request comes from a remote browser — the `FLUZY_SETUP_CODE` (the field is
   shown from the start, so nothing is submitted blindly).
2. Add provider keys on **Keys** in the dashboard.
4. Point any OpenAI-compatible client at `https://<deployment>/v1` with the
   unified key from the Keys page.

## How persistence behaves

- **Boot**: the function downloads `fluzyai.db` from the bucket (if present)
  into `/tmp`, then opens it and runs migrations. A cold start therefore costs
  one small download.
- **Writes**: every `INSERT`/`UPDATE`/`DDL` marks the database dirty.
- **End of request**: the handler awaits the upload (WAL checkpointed first)
  before returning, because work scheduled after a response may never run.
- **No-op writes** (a session touch, an idempotent `UPDATE`) are skipped when
  the file's size and mtime are unchanged since the last upload.

### Known limits of running on Vercel

These are platform limits, not application bugs:

- **Request body ≤ 4.5 MB** on Hobby/Pro functions. Very large vision payloads
  (inline base64 screenshots) that the self-hosted server accepts up to 25 MB
  will be rejected by the platform before Fluzy AI sees them.
- **60 s per invocation** (`maxDuration`). A long streamed completion can be cut
  off; short and medium requests are unaffected.
- **One snapshot writer.** Two instances writing at the same time will
  last-write-wins on the bucket. Single-user deployments normally run one warm
  instance; for guaranteed multi-writer behaviour run the Docker/server build
  against a shared filesystem instead.
- **Cold starts** re-download the snapshot and re-run migrations (both are
  fast — well under a second for a typical database).
- Background schedulers (key health checks, catalog sync, backup dumps) do not
  run on serverless. Model key health is refreshed on demand from the dashboard;
  point the Backups feature at an external URL if you need scheduled dumps.

## Self-hosting instead

Nothing here is required for Docker, a VPS, a Raspberry Pi or the desktop app —
those keep using `server/src/index.ts` with `better-sqlite3` and a real data
directory. See [Install & deploy](../install/01-install.md).
