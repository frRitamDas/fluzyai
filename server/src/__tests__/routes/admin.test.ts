import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';

async function call(app: Express, method: string, path: string, body?: any, token?: string) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as any;
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data };
}

/**
 * The admin panel and the multi-user split.
 *
 * Two kinds of account share one deployment: the operator, who owns the provider
 * key pool and the announcements, and everyone else, who only uses them. These
 * tests pin down the boundary in both directions — an owner address is promoted
 * without any manual step, and an ordinary account is refused every admin
 * surface (including writes to the shared key pool).
 */
describe('Admin panel and roles', () => {
  let app: Express;
  let ownerToken: string;
  let userToken: string;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    // Both addresses belong to the same person; FLUZY_ADMIN_EMAILS is left unset
    // so the built-in owner list is what grants access.
    delete process.env.FLUZY_ADMIN_EMAILS;
    initDb(':memory:');
    app = createApp();
  });

  it('promotes the owner address automatically at signup', async () => {
    const { status, body } = await call(app, 'POST', '/api/auth/register', {
      email: 'ritam73592@gmail.com',
      password: 'owner-secret-1',
    });
    expect(status).toBe(201);
    // No second step: the response itself says the panel is open to them.
    expect(body.isAdmin).toBe(true);
    ownerToken = body.token;

    const me = await call(app, 'GET', '/api/admin/me', undefined, ownerToken);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: 'ritam73592@gmail.com', isAdmin: true });
  });

  it('gives an ordinary signup no admin access', async () => {
    const { status, body } = await call(app, 'POST', '/api/auth/register', {
      email: 'someone@example.com',
      password: 'someone-secret-1',
    });
    expect(status).toBe(201);
    expect(body.role).toBe('user');
    expect(body.isAdmin).toBe(false);
    userToken = body.token;

    expect((await call(app, 'GET', '/api/admin/me', undefined, userToken)).status).toBe(403);
    expect((await call(app, 'GET', '/api/admin/overview', undefined, userToken)).status).toBe(403);
    expect((await call(app, 'GET', '/api/admin/users', undefined, userToken)).status).toBe(403);
    // The provider pool is global, so writing to it is an admin act even though
    // reading it (to see what is available) is not.
    expect((await call(app, 'POST', '/api/keys', { platform: 'groq', key: 'x' }, userToken)).status).toBe(403);
    expect((await call(app, 'DELETE', '/api/keys/1', undefined, userToken)).status).toBe(403);
    // Reading stays open: the dashboard shows which providers are configured.
    expect((await call(app, 'GET', '/api/keys', undefined, userToken)).status).toBe(200);
  });

  it('reports the deployment in the overview', async () => {
    const { status, body } = await call(app, 'GET', '/api/admin/overview', undefined, ownerToken);
    expect(status).toBe(200);
    expect(body.users.total).toBeGreaterThanOrEqual(2);
    expect(body.users.admins).toBe(1);
    expect(body).toHaveProperty('keys.total');
    expect(body).toHaveProperty('models.total');
    expect(body).toHaveProperty('requests.today');
  });

  it('lists the provider catalog without leaking anything secret', async () => {
    const { status, body } = await call(app, 'GET', '/api/admin/providers', undefined, ownerToken);
    expect(status).toBe(200);
    expect(body.providers.length).toBeGreaterThan(5);
    for (const provider of body.providers) {
      expect(typeof provider.platform).toBe('string');
      expect(provider).not.toHaveProperty('apiKey');
      expect(provider).not.toHaveProperty('encryptedKey');
    }
  });

  it('lists accounts with their roles', async () => {
    const { status, body } = await call(app, 'GET', '/api/admin/users', undefined, ownerToken);
    expect(status).toBe(200);
    const emails = body.users.map((u: any) => u.email);
    expect(emails).toContain('ritam73592@gmail.com');
    expect(emails).toContain('someone@example.com');
    expect(body.users.find((u: any) => u.email === 'ritam73592@gmail.com').role).toBe('admin');
  });

  it('refuses to let the last admin demote themselves', async () => {
    const me = await call(app, 'GET', '/api/admin/me', undefined, ownerToken);
    const { status, body } = await call(app, 'PATCH', `/api/admin/users/${me.body.id}`, { role: 'user' }, ownerToken);
    expect(status).toBe(400);
    expect(body.error.type).toBe('self_demote');
  });

  it('publishes an announcement that anonymous visitors can read', async () => {
    const created = await call(app, 'POST', '/api/admin/announcements', {
      title: 'Maintenance',
      body: 'Groq is rate-limited until 18:00 UTC.',
      level: 'warning',
    }, ownerToken);
    expect(created.status).toBe(201);

    // The banner is public: the home page shows it before anyone signs in.
    const anon = await call(app, 'GET', '/api/announcements');
    expect(anon.status).toBe(200);
    expect(anon.body.announcements[0]).toMatchObject({ title: 'Maintenance', level: 'warning' });

    // Hiding it removes it from the public list without deleting the record.
    const hidden = await call(app, 'PATCH', `/api/admin/announcements/${created.body.announcement.id}`,
      { active: false }, ownerToken);
    expect(hidden.status).toBe(200);
    expect((await call(app, 'GET', '/api/announcements')).body.announcements).toHaveLength(0);

    expect((await call(app, 'DELETE', `/api/admin/announcements/${created.body.announcement.id}`,
      undefined, ownerToken)).status).toBe(200);
  });

  it('refuses to let a normal account post announcements', async () => {
    const { status } = await call(app, 'POST', '/api/admin/announcements', {
      title: 'Hi', body: 'from a stranger',
    }, userToken);
    expect(status).toBe(403);
  });

  it('mints a separate inference key per account', async () => {
    const owner = await call(app, 'GET', '/api/settings/api-key', undefined, ownerToken);
    const user = await call(app, 'GET', '/api/settings/api-key', undefined, userToken);
    expect(owner.body.apiKey).toMatch(/^fluzyai-[0-9a-f]{48}$/);
    expect(user.body.apiKey).toMatch(/^fluzyai-[0-9a-f]{48}$/);
    expect(owner.body.apiKey).not.toBe(user.body.apiKey);

    // Reading twice is stable; rotating only affects the one account.
    expect((await call(app, 'GET', '/api/settings/api-key', undefined, userToken)).body.apiKey).toBe(user.body.apiKey);
    const rotated = await call(app, 'POST', '/api/settings/api-key/regenerate', undefined, userToken);
    expect(rotated.body.apiKey).not.toBe(user.body.apiKey);
    expect((await call(app, 'GET', '/api/settings/api-key', undefined, ownerToken)).body.apiKey).toBe(owner.body.apiKey);
  });

  it('keeps the deployment-wide key for the admin only', async () => {
    expect((await call(app, 'GET', '/api/settings/api-key/deployment', undefined, ownerToken)).status).toBe(200);
    expect((await call(app, 'GET', '/api/settings/api-key/deployment', undefined, userToken)).status).toBe(403);
  });
});
