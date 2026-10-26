import { getDb, getSetting, setSetting } from '../db/index.js';

/**
 * Who may use the shared model pool, and how much.
 *
 * The provider keys are one deployment-wide pool, so "give everyone my models"
 * and "let this person in particular" are the same question asked twice. This
 * module is the single place that answers it:
 *
 *   signupOpen()          can a new account be created at all
 *   defaultApiAccess()    what a brand-new account starts with
 *   defaultDailyLimit()   its starting per-day request cap (null = unlimited)
 *   inferenceDenial()     may THIS account call /v1 right now
 *   recordInference()     count the call against the day's quota
 *
 * Account-level switches (users.status / api_access / daily_limit) live on the
 * user row; the deployment-wide defaults live in `settings`, so an operator can
 * change them from the panel and they survive a restart and a snapshot restore.
 */

export type UserStatus = 'active' | 'suspended';

export interface AccessDenial {
  /** HTTP status the inference surface should answer with. */
  status: number;
  /** Machine-readable error type, matching the shape /v1 already emits. */
  type: string;
  message: string;
}

// ── Deployment-wide settings ───────────────────────────────────────────────

/** Whether the deployment accepts new accounts. FLUZY_ALLOW_SIGNUP=0 wins. */
export function signupOpen(): boolean {
  const raw = (process.env.FLUZY_ALLOW_SIGNUP ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  return getSetting('access.signup_open') !== '0';
}

export function setSignupOpen(open: boolean): void {
  setSetting('access.signup_open', open ? '1' : '0');
}

/** Whether accounts created from now on may use /v1 out of the box. */
export function defaultApiAccess(): boolean {
  return getSetting('access.default_api_access') !== '0';
}

export function setDefaultApiAccess(allowed: boolean): void {
  setSetting('access.default_api_access', allowed ? '1' : '0');
}

/** Per-day request cap applied to accounts created from now on. */
export function defaultDailyLimit(): number | null {
  const raw = (getSetting('access.default_daily_limit') ?? '').trim();
  if (raw === '') return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function setDefaultDailyLimit(limit: number | null): void {
  setSetting('access.default_daily_limit', limit === null ? '' : String(limit));
}

export interface AccessSettings {
  signupOpen: boolean;
  defaultApiAccess: boolean;
  defaultDailyLimit: number | null;
}

export function accessSettings(): AccessSettings {
  return {
    signupOpen: signupOpen(),
    defaultApiAccess: defaultApiAccess(),
    defaultDailyLimit: defaultDailyLimit(),
  };
}

// ── The admin console's URL ────────────────────────────────────────────────

/**
 * The path the panel is served on.
 *
 * The panel itself is behind a session check, but a guessable URL still invites
 * probing: every request to it costs a 401 and tells a stranger the deployment
 * is somebody's private console. Serving it on an unguessable path (set
 * FLUZY_ADMIN_PATH, or use the built-in default) means a stranger who types
 * /admin gets the ordinary not-found page instead.
 *
 * Deliberately NOT a security boundary — the role check is. This only removes
 * the invitation.
 */
export const DEFAULT_ADMIN_PATH = '/ops-7f3a91c4';

export function adminPath(): string {
  const raw = (process.env.FLUZY_ADMIN_PATH ?? '').trim().toLowerCase();
  if (!raw) return DEFAULT_ADMIN_PATH;
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  // Never `/`, never a trailing slash, never anything that would collide with
  // the app's own routes.
  const normalized = withSlash.replace(/\/+$/, '');
  if (normalized.length < 2) return DEFAULT_ADMIN_PATH;
  const reserved = ['/api', '/v1', '/v1beta', '/mcp', '/login', '/signup', '/admin'];
  return reserved.includes(normalized) ? DEFAULT_ADMIN_PATH : normalized;
}

// ── Per-account usage ──────────────────────────────────────────────────────

function today(): string {
  // UTC day: one boundary for every deployment, and one an operator can reason
  // about from the panel without knowing the instance's timezone.
  return new Date().toISOString().slice(0, 10);
}

export function requestsToday(userId: number): number {
  const row = getDb()
    .prepare('SELECT requests FROM user_usage WHERE user_id = ? AND day = ?')
    .get(userId, today()) as { requests: number } | undefined;
  return row?.requests ?? 0;
}

/** Count one inference request against the account's day. */
export function recordInference(userId: number): void {
  getDb()
    .prepare(`
      INSERT INTO user_usage (user_id, day, requests) VALUES (?, ?, 1)
      ON CONFLICT(user_id, day) DO UPDATE SET requests = requests + 1
    `)
    .run(userId, today());
}

/** Usage for a set of accounts, in one query (the admin account list). */
export function usageTodayFor(userIds: number[]): Map<number, number> {
  const result = new Map<number, number>();
  if (userIds.length === 0) return result;
  const placeholders = userIds.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT user_id, requests FROM user_usage WHERE day = ? AND user_id IN (${placeholders})`)
    .all(today(), ...userIds) as { user_id: number; requests: number }[];
  for (const row of rows) result.set(row.user_id, row.requests);
  return result;
}

export interface AccountAccessRow {
  id: number;
  status: string;
  api_access: number;
  daily_limit: number | null;
}

export function accountAccess(userId: number): AccountAccessRow | null {
  const row = getDb()
    .prepare('SELECT id, status, api_access, daily_limit FROM users WHERE id = ?')
    .get(userId) as AccountAccessRow | undefined;
  return row ?? null;
}

/**
 * May this account call /v1 right now?
 *
 * Order matters for the message the caller gets: a suspended account is told it
 * is suspended (not "rate limited"), and an account without API access is told
 * that, rather than being handed a generic invalid-key error that sends its
 * owner hunting for a typo in a key that is perfectly valid.
 */
export function inferenceDenial(userId: number): AccessDenial | null {
  const row = accountAccess(userId);
  if (!row) {
    return { status: 401, type: 'authentication_error', message: 'Invalid API key' };
  }
  if (row.status === 'suspended') {
    return {
      status: 403,
      type: 'account_suspended',
      message: 'This account is suspended. Contact the deployment admin.',
    };
  }
  if (row.api_access !== 1) {
    return {
      status: 403,
      type: 'api_access_disabled',
      message: 'API access is turned off for this account. Contact the deployment admin.',
    };
  }
  if (row.daily_limit !== null) {
    const used = requestsToday(userId);
    if (used >= row.daily_limit) {
      return {
        status: 429,
        type: 'daily_limit_reached',
        message: `Daily limit reached (${row.daily_limit} requests). It resets at 00:00 UTC.`,
      };
    }
  }
  return null;
}
