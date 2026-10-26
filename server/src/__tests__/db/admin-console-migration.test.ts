import { describe, it, expect } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { down, up } from '../../db/migrations/20261028_000001_admin_console.js';

function cols(table: string) {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
}

function hasTable(table: string): boolean {
  return !!getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
}

// Access control adds three account columns, one counter table and three
// deployment settings. Reversible, and idempotent because catalog sync re-runs
// it over a live schema.
describe('admin console migration', () => {
  it('is reversible and idempotent', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');

    expect(cols('users')).toEqual(expect.arrayContaining(['status', 'api_access', 'daily_limit']));
    expect(hasTable('user_usage')).toBe(true);
    expect(getDb().prepare("SELECT value FROM settings WHERE key = 'access.signup_open'").get())
      .toEqual({ value: '1' });

    down(getDb());
    expect(cols('users')).not.toContain('status');
    expect(cols('users')).not.toContain('api_access');
    expect(cols('users')).not.toContain('daily_limit');
    expect(hasTable('user_usage')).toBe(false);
    expect(getDb().prepare("SELECT value FROM settings WHERE key = 'access.signup_open'").get()).toBeUndefined();

    up(getDb());
    up(getDb());
    expect(cols('users')).toEqual(expect.arrayContaining(['status', 'api_access', 'daily_limit']));
    expect(hasTable('user_usage')).toBe(true);
    // An upgrade must not reset a setting the operator already changed.
    getDb().prepare("UPDATE settings SET value = '0' WHERE key = 'access.signup_open'").run();
    up(getDb());
    expect(getDb().prepare("SELECT value FROM settings WHERE key = 'access.signup_open'").get())
      .toEqual({ value: '0' });
  });
});
