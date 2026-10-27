import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { createSession } from '../../services/auth.js';

// The signed-in home screen asks for one summary instead of six endpoints, so
// there is exactly one place where "who am I, what is my key, how much have I
// used, is anything working" can be assembled wrongly. These tests pin the
// contract the page renders from — and the one thing it must never leak.

let app: Express;
const email = 'home@example.com';
let token: string;

function listen(a: Express): Promise<{ url: string; close: () => void }> {
  return new Promise(resolve => {
    const server = a.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  initDb(':memory:');
  const db = getDb();
  const now = Date.now();
  const info = db
    .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
    .run(email, 'x', now);
  const userId = Number(info.lastInsertRowid);
  token = createSession(userId);
  // One healthy provider key and one model, so the counts are not all zero by
  // accident — a payload of zeroes would pass a looser assertion.
  db.prepare(
    "INSERT INTO api_keys (platform, encrypted_key, iv, auth_tag, enabled, status) VALUES ('groq', 'x', 'y', 'z', 1, 'healthy')",
  ).run();
  app = createApp();
});

async function get(path: string, bearer?: string) {
  const server = await listen(app);
  const res = await fetch(`${server.url}${path}`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });
  const body = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body, headers: res.headers };
}

describe('GET /api/home', () => {
  it('refuses an anonymous caller', async () => {
    const { status, body } = await get('/api/home');
    expect(status).toBe(401);
    expect(body.error.type).toBe('authentication_error');
  });

  it('returns the signed-in account, its own key and live counts', async () => {
    const { status, body, headers } = await get('/api/home', token);
    expect(status).toBe(200);
    expect(body.account.email).toBe(email);
    expect(body.account.role).toBe('user');
    expect(body.account.apiAccess).toBe(true);
    expect(body.account.requestsToday).toBe(0);
    // The key is the account's own, minted on first read and stable afterwards.
    expect(body.key.apiKey).toMatch(/^fluzyai-[0-9a-f]{48}$/);
    expect(body.models.enabled).toBeGreaterThan(0);
    expect(body.providers.configured).toBe(1);
    expect(body.providers.healthy).toBe(1);
    expect(body.announcements).toEqual([]);
    // Private, per-session data must not be cacheable.
    expect(headers.get('cache-control')).toBe('no-store');

    const again = await get('/api/home', token);
    expect(again.body.key.apiKey).toBe(body.key.apiKey);
  });

  it('reports a suspended account as having lost API access', async () => {
    const db = getDb();
    db.prepare("UPDATE users SET status = 'suspended' WHERE email = ?").run(email);
    const { status, body } = await get('/api/home', token);
    // requireAuth signs a suspended account out of the dashboard entirely.
    expect(status).toBe(403);
    expect(body.error.type).toBe('account_suspended');
    db.prepare("UPDATE users SET status = 'active' WHERE email = ?").run(email);
  });

  it('reflects an admin-granted daily limit', async () => {
    const db = getDb();
    db.prepare('UPDATE users SET daily_limit = 25 WHERE email = ?').run(email);
    const { body } = await get('/api/home', token);
    expect(body.account.dailyLimit).toBe(25);
  });

  it('surfaces published notices, so the home page needs no second request', async () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO announcements (title, body, level, active) VALUES ('Maintenance', 'Groq is paused.', 'warning', 1)",
    ).run();
    const { body } = await get('/api/home', token);
    expect(body.announcements).toHaveLength(1);
    expect(body.announcements[0].title).toBe('Maintenance');
  });
});
