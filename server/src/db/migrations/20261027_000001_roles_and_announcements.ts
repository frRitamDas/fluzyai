// Migration: roles, per-user API keys, and global announcements
// Created: 2026-10-27
//
// DOWN: reversible (drop the columns/index/table)
//
// The dashboard started life as a single-tenant app: one account, one shared
// pool of provider keys, one unified API key in `settings`. Multi-user signup
// turns that into three distinct things:
//
//   users.role       'admin' or 'user'. Admins manage the shared pool of
//                    provider keys (the "global" catalog every account can
//                    call) and post announcements; everyone else uses them.
//   users.api_key    one inference key per account, so /v1 traffic is
//                    attributable and a key can be rotated without touching
//                    anyone else. Lazy: minted the first time it is read.
//   announcements    the global banner every signed-in account sees.
//
// Guarded like every other column add (catalog-sync re-runs migrations over a
// live schema, so ALTERs must be idempotent).

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

export function up(db: Db): void {
  if (!hasColumn(db, 'users', 'role')) {
    // Existing installs predate roles. They were all single-operator, so the
    // account that is already there IS the operator: backfill 'admin' rather
    // than leaving a deployment nobody can administer.
    db.prepare("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'").run();
    db.prepare("UPDATE users SET role = 'admin'").run();
  }

  if (!hasColumn(db, 'users', 'api_key')) {
    db.prepare('ALTER TABLE users ADD COLUMN api_key TEXT').run();
  }
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)').run();

  if (!hasTable(db, 'announcements')) {
    db.prepare(`
      CREATE TABLE announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(active, created_at)').run();
  }
}

export function down(db: Db): void {
  db.prepare('DROP TABLE IF EXISTS announcements').run();
  if (hasColumn(db, 'users', 'api_key')) {
    db.prepare('DROP INDEX IF EXISTS idx_users_api_key').run();
    db.prepare('ALTER TABLE users DROP COLUMN api_key').run();
  }
  if (hasColumn(db, 'users', 'role')) {
    db.prepare('ALTER TABLE users DROP COLUMN role').run();
  }
}
