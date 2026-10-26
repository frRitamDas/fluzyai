// Migration: the admin console — account access control and deployment settings
// Created: 2026-10-28
//
// DOWN: reversible (drop the columns/table; seeded settings rows are removed)
//
// The first admin release gave roles and a shared provider pool. Running a real
// deployment needs three more things, all per-account:
//
//   users.status       'active' or 'suspended'. A suspended account keeps its
//                      data but cannot sign in or call /v1 — it is the "stop,
//                      without deleting" lever.
//   users.api_access   1/0. Whether this account may use the shared provider
//                      pool through /v1 at all. Signing in to the dashboard is a
//                      separate matter, which is why this is not `status`.
//   users.daily_limit  NULL = unlimited, otherwise the number of /v1 requests the
//                      account may make per UTC day. Enforced against
//                      user_usage below.
//   user_usage         (user_id, day, requests) — a tiny counter table rather
//                      than a scan of `requests`, so the quota check on the hot
//                      path stays one indexed upsert.
//
// Deployment-wide defaults live in `settings`, so they survive restarts and
// snapshots and can be changed from the panel without a redeploy:
//   access.signup_open, access.default_api_access, access.default_daily_limit
//
// Guarded like every other column add: catalog sync re-runs migrations over a
// live schema, so the ALTERs must be idempotent.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some(col => col.name === column);
}

function hasTable(db: Db, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return !!row;
}

const DEFAULTS: { key: string; value: string }[] = [
  // Sign-up is open: this is a shared deployment, and an operator who wants it
  // closed flips the switch in the panel (or sets FLUZY_ALLOW_SIGNUP=0).
  { key: 'access.signup_open', value: '1' },
  { key: 'access.default_api_access', value: '1' },
  { key: 'access.default_daily_limit', value: '' },
];

export function up(db: Db): void {
  if (!hasColumn(db, 'users', 'status')) {
    db.prepare("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'").run();
  }
  if (!hasColumn(db, 'users', 'api_access')) {
    db.prepare('ALTER TABLE users ADD COLUMN api_access INTEGER NOT NULL DEFAULT 1').run();
  }
  if (!hasColumn(db, 'users', 'daily_limit')) {
    db.prepare('ALTER TABLE users ADD COLUMN daily_limit INTEGER').run();
  }

  if (!hasTable(db, 'user_usage')) {
    db.prepare(`
      CREATE TABLE user_usage (
        user_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      )
    `).run();
  }

  for (const { key, value } of DEFAULTS) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

export function down(db: Db): void {
  db.prepare('DROP TABLE IF EXISTS user_usage').run();
  for (const { key } of DEFAULTS) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
  if (hasColumn(db, 'users', 'daily_limit')) {
    db.prepare('ALTER TABLE users DROP COLUMN daily_limit').run();
  }
  if (hasColumn(db, 'users', 'api_access')) {
    db.prepare('ALTER TABLE users DROP COLUMN api_access').run();
  }
  if (hasColumn(db, 'users', 'status')) {
    db.prepare('ALTER TABLE users DROP COLUMN status').run();
  }
}
