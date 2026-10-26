import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { normalizeEmail } from './auth.js';

/**
 * Dashboard roles.
 *
 * The gateway is deployed once and shared: admins own the provider-key pool the
 * router draws on (the "global" catalog every account can call), everyone else
 * uses it. That distinction is a role on `users`, not a second database —
 * provider keys, models, routing and quotas stay exactly where they were, so a
 * key an admin adds is live for every account the moment it is stored.
 *
 * Who is an admin is decided by the account's email, so the owner never has to
 * be granted anything by hand:
 *
 *   FLUZY_ADMIN_EMAILS   comma-separated addresses; unset uses OWNER_EMAILS
 *
 * A matching account is promoted automatically at signup, at sign-in, and on
 * every boot (for accounts that existed before the feature). Promotion is
 * one-way on purpose: removing an address from the list does not strip an admin
 * silently, which would be a bad surprise on a live deployment — an admin can
 * still demote another admin from the panel.
 */

export type Role = 'admin' | 'user';

/**
 * The deployment owner. These are the addresses that always come back as admin,
 * so the operator of this instance can never lock themselves out of the panel
 * they are entitled to. Both are the same person's addresses (the Vercel account
 * owner and the one used to sign up), which is why both are listed.
 */
export const OWNER_EMAILS = ['ritam73592@gmail.com', 'ritamdas20012@gmail.com'] as const;

function parseEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map(value => value.trim().toLowerCase())
    .filter(value => value.length > 0 && value.includes('@'));
}

/**
 * Whether an address is on the admin list. Compared case-insensitively and
 * trimmed, because an email typed into a signup form arrives with whatever
 * casing the keyboard had.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  const configured = parseEmails(process.env.FLUZY_ADMIN_EMAILS);
  const allow = configured.length > 0 ? configured : OWNER_EMAILS.map(e => e.toLowerCase());
  return allow.includes(normalized);
}

/** Promote an account whose email is on the admin list. Returns the new role. */
export function syncRoleForEmail(email: string): Role {
  const db = getDb();
  const normalized = normalizeEmail(email);
  const row = db.prepare('SELECT id, role FROM users WHERE email = ?').get(normalized) as
    | { id: number; role: string }
    | undefined;
  if (!row) return 'user';
  if (!isAdminEmail(normalized)) return (row.role === 'admin' ? 'admin' : 'user');
  if (row.role === 'admin') return 'admin';
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(row.id);
  return 'admin';
}

/**
 * Promote every account whose email is on the admin list. Runs at boot so an
 * install that predates roles (or an address added to FLUZY_ADMIN_EMAILS since
 * the last boot) is administered from the first request, without waiting for
 * that person to sign in.
 */
export function syncOwnerRoles(): number {
  const db = getDb();
  const emails = db.prepare('SELECT email FROM users').all() as { email: string }[];
  let promoted = 0;
  for (const { email } of emails) {
    const before = db.prepare('SELECT role FROM users WHERE email = ?').get(email) as { role: string } | undefined;
    if (before?.role === 'admin') continue;
    if (syncRoleForEmail(email) === 'admin') promoted++;
  }
  return promoted;
}

export function roleForUser(userId: number): Role {
  const row = getDb().prepare('SELECT role FROM users WHERE id = ?').get(userId) as
    | { role: string }
    | undefined;
  return row?.role === 'admin' ? 'admin' : 'user';
}

export function isAdminUser(userId: number): boolean {
  return roleForUser(userId) === 'admin';
}

/**
 * Whether this session may use the admin panel.
 *
 * Desktop installs are exempt: the app has one hidden machine account
 * (`desktop@localhost`) that predates roles and owns its local database, so
 * every admin surface has to stay open there or the desktop build loses the
 * Keys page it has always had. A hosted deployment is never in desktop mode.
 */
export function isAdminSession(userId: number): boolean {
  if (process.env.FLUZY_DESKTOP === '1') return true;
  return isAdminUser(userId);
}

/**
 * Make an account an admin. Used for the account that CLAIMS a fresh install:
 * whoever creates the first account is by definition the person hosting it, so
 * they get the panel even if their address is not on FLUZY_ADMIN_EMAILS. Later
 * accounts are only promoted by the email list or by another admin.
 */
export function setFirstAdmin(userId: number): Role {
  getDb().prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(userId);
  return 'admin';
}

/** Number of accounts that can still administer this deployment. */
export function adminCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number };
  return row.c;
}

export interface AdminUserRow {
  id: number;
  email: string;
  role: Role;
  createdAt: string;
  hasApiKey: boolean;
}

export function listUsers(): AdminUserRow[] {
  const rows = getDb().prepare(
    'SELECT id, email, role, created_at, api_key FROM users ORDER BY id ASC',
  ).all() as { id: number; email: string; role: string; created_at: string; api_key: string | null }[];
  return rows.map(row => ({
    id: row.id,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'user',
    createdAt: row.created_at,
    hasApiKey: !!row.api_key,
  }));
}

/**
 * Change an account's role. Refuses to remove the last admin, which would leave
 * a deployment with a provider-key pool nobody can administer.
 */
export function setUserRole(userId: number, role: Role): { ok: true } | { ok: false; error: string } {
  const db = getDb();
  const row = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as
    | { id: number; role: string }
    | undefined;
  if (!row) return { ok: false, error: 'No such account' };
  if (row.role === 'admin' && role !== 'admin' && adminCount() <= 1) {
    return { ok: false, error: 'This is the only admin left — promote someone else first' };
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  return { ok: true };
}

// ── Per-account inference keys ────────────────────────────────────────────
// One /v1 credential per account, minted lazily and stored on the user row.
// The deployment-wide key in `settings` keeps working (it is what existing
// scripts and the desktop app use, and what every pre-multi-user install has),
// so nothing breaks by introducing these.

const KEY_PREFIX = 'fluzyai-';

/** The account's inference key, minting one on first use. */
export function userApiKey(userId: number): string {
  const db = getDb();
  const row = db.prepare('SELECT api_key FROM users WHERE id = ?').get(userId) as
    | { api_key: string | null }
    | undefined;
  if (!row) throw new Error('No such account');
  if (row.api_key) return row.api_key;
  return rotateUserApiKey(userId);
}

/** Replace the account's inference key. Existing clients stop working. */
export function rotateUserApiKey(userId: number): string {
  const db = getDb();
  const key = `${KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
  db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(key, userId);
  return key;
}

/**
 * Resolve an /v1 bearer token to the account that owns it.
 *
 * Returns null for an unknown token; the caller falls back to the
 * deployment-wide key and client profiles. Timing-safe comparison is not needed
 * for the lookup itself (the value is an index key and the query is a plain
 * equality on an opaque 56-character secret), but the deployment-wide key is
 * still compared the way it always was — see lib/system-prompt.ts.
 */
export function userForApiKey(token: string | undefined | null): { userId: number; email: string } | null {
  if (!token || !token.startsWith(KEY_PREFIX)) return null;
  const row = getDb().prepare('SELECT id, email FROM users WHERE api_key = ?').get(token) as
    | { id: number; email: string }
    | undefined;
  return row ? { userId: row.id, email: row.email } : null;
}
