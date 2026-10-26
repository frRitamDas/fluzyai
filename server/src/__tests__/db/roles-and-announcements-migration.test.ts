import { describe, it, expect } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { down, up } from '../../db/migrations/20261027_000001_roles_and_announcements.js';
import { createUser } from '../../services/auth.js';

function cols(table: string) {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
}

// The one migration that turns a single-tenant install into a multi-user one.
// It has to be reversible (the migration runner round-trips every file) and
// idempotent (catalog sync re-runs it over a live schema), and its backfill is
// what keeps an upgraded deployment administrable.
describe('roles and announcements migration', () => {
  it('is reversible and idempotent', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    const user = createUser('backfill@example.com', 'password123');
    expect(cols('users')).toContain('role');
    expect(cols('users')).toContain('api_key');
    // A fresh install has no users when the migration runs, so a later signup
    // starts as a plain user (the first account is promoted at setup, not here).
    expect(getDb().prepare('SELECT role FROM users WHERE id = ?').get(user.userId)).toEqual({ role: 'user' });

    down(getDb());
    expect(cols('users')).not.toContain('role');
    expect(cols('users')).not.toContain('api_key');
    expect(cols('users')).toEqual(['id', 'email', 'password_hash', 'created_at']);

    up(getDb());
    up(getDb());
    expect(cols('users')).toContain('role');
    // A re-run backfills the accounts already present, so an upgrade never
    // leaves a deployment nobody can administer.
    expect(getDb().prepare('SELECT role FROM users WHERE id = ?').get(user.userId)).toEqual({ role: 'admin' });
  });
});
