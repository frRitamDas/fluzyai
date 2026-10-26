import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { getAllProviders, resolveProvider } from '../providers/index.js';
import { encrypt, maskKey, decrypt } from '../lib/crypto.js';
import { isSearchPlatform } from '../lib/search-platforms.js';
import { triggerBuiltinModelDiscovery } from '../services/builtin-model-discovery.js';
import { clearCooldownsForKey } from '../services/ratelimit.js';
import {
  adminCount,
  isAdminSession,
  listUsers,
  roleForUser,
  setUserApiAccess,
  setUserDailyLimit,
  setUserRole,
  setUserStatus,
  rotateUserApiKey,
  type Role,
} from '../services/roles.js';
import {
  accessSettings,
  adminPath,
  setDefaultApiAccess,
  setDefaultDailyLimit,
  setSignupOpen,
} from '../services/access.js';
import { remoteDbStatus } from '../lib/remote-db.js';
import { checkAllKeys, checkKeyHealth } from '../services/health.js';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  createAnnouncement,
  deleteAnnouncement,
  listAllAnnouncements,
  updateAnnouncement,
} from '../services/announcements.js';
import type { Platform } from '@fluzyai/shared/types.js';

/**
 * The admin panel's API.
 *
 * Everything here manages the SHARED deployment: the provider keys the router
 * draws on for every account, who else may administer it, and the banner every
 * visitor sees. Adding a provider key is deliberately the same act as adding one
 * from the Keys page — one `api_keys` row, immediately eligible for routing —
 * so "push it to global" is not a second code path with its own bugs; it is the
 * same pool, with the panel as the only door most accounts have to it.
 *
 * Mounted behind requireAuth + requireAdmin (see app.ts), so the "only the
 * owner" rule is enforced by the router, not by hiding a link in the UI.
 */
export const adminRouter = Router();

// ── Overview ──────────────────────────────────────────────────────────────
adminRouter.get('/overview', (_req: Request, res: Response) => {
  const db = getDb();
  const count = (sql: string, ...params: unknown[]): number => {
    const row = db.prepare(sql).get(...params) as { c: number } | undefined;
    return row?.c ?? 0;
  };

  res.json({
    users: {
      total: count('SELECT COUNT(*) AS c FROM users'),
      admins: adminCount(),
    },
    keys: {
      total: count('SELECT COUNT(*) AS c FROM api_keys'),
      enabled: count('SELECT COUNT(*) AS c FROM api_keys WHERE enabled = 1'),
      healthy: count("SELECT COUNT(*) AS c FROM api_keys WHERE status = 'healthy'"),
      platforms: count('SELECT COUNT(DISTINCT platform) AS c FROM api_keys'),
    },
    models: {
      total: count('SELECT COUNT(*) AS c FROM models'),
      enabled: count('SELECT COUNT(*) AS c FROM models WHERE enabled = 1'),
    },
    requests: {
      total: count('SELECT COUNT(*) AS c FROM requests'),
      today: count("SELECT COUNT(*) AS c FROM requests WHERE date(created_at) = date('now')"),
    },
    announcements: {
      active: count('SELECT COUNT(*) AS c FROM announcements WHERE active = 1'),
    },
    // Snapshot state, so "did my change survive?" is answerable from here
    // instead of from the platform's logs. A failing upload is the one thing
    // that makes dashboard changes disappear, and it used to be invisible.
    persistence: remoteDbStatus(),
    access: {
      ...accessSettings(),
      suspended: count("SELECT COUNT(*) AS c FROM users WHERE status = 'suspended'"),
      withoutApiAccess: count('SELECT COUNT(*) AS c FROM users WHERE api_access = 0'),
    },
  });
});

// ── Provider catalog (what the "add a provider" picker offers) ────────────
adminRouter.get('/providers', (_req: Request, res: Response) => {
  const db = getDb();
  const counts = db.prepare(`
    SELECT platform, COUNT(*) AS total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled
    FROM api_keys GROUP BY platform
  `).all() as { platform: string; total: number; enabled: number }[];
  const byPlatform = new Map(counts.map(row => [row.platform, row]));

  const modelCounts = db.prepare(`
    SELECT platform, COUNT(*) AS total FROM models WHERE enabled = 1 GROUP BY platform
  `).all() as { platform: string; total: number }[];
  const modelsByPlatform = new Map(modelCounts.map(row => [row.platform, row.total]));

  res.json({
    providers: getAllProviders()
      .filter(provider => provider.platform !== 'custom')
      .map(provider => {
        const row = byPlatform.get(provider.platform);
        return {
          platform: provider.platform,
          name: provider.name,
          keyless: provider.keyless === true,
          kind: isSearchPlatform(provider.platform) ? 'search' : 'chat',
          keyCount: row?.total ?? 0,
          enabledKeyCount: row?.enabled ?? 0,
          modelCount: modelsByPlatform.get(provider.platform) ?? 0,
        };
      })
      // Configured providers first (that is what an operator usually wants to
      // see next), then alphabetical.
      .sort((a, b) => {
        const delta = (b.keyCount > 0 ? 1 : 0) - (a.keyCount > 0 ? 1 : 0);
        return delta !== 0 ? delta : a.name.localeCompare(b.name);
      }),
  });
});

// ── The global provider-key pool ──────────────────────────────────────────
adminRouter.get('/keys', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM api_keys ORDER BY platform, id').all() as {
    id: number;
    platform: string;
    label: string | null;
    encrypted_key: string;
    iv: string;
    auth_tag: string;
    status: string;
    enabled: number;
    created_at: string;
    last_checked_at: string | null;
    last_health_error: string | null;
  }[];

  res.json({
    keys: rows.map(row => {
      let masked = '••••';
      try {
        masked = maskKey(decrypt(row.encrypted_key, row.iv, row.auth_tag));
      } catch {
        masked = '(unreadable)';
      }
      return {
        id: row.id,
        platform: row.platform,
        label: row.label ?? '',
        maskedKey: masked,
        status: row.status,
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        lastCheckedAt: row.last_checked_at,
        lastError: row.last_health_error,
      };
    }),
  });
});

const addKeySchema = z.object({
  platform: z.string().trim().min(1),
  key: z.string().trim().optional(),
  label: z.string().trim().max(200).optional(),
});

/**
 * Add a provider key to the global pool.
 *
 * Same storage as `POST /api/keys` (encrypted at rest, one row per key), minus
 * the custom-endpoint branches: the panel is for well-known providers, where
 * the platform alone determines the adapter. The probe runs inline so the
 * operator learns immediately whether the key works instead of finding out from
 * a failing request later.
 */
adminRouter.post('/keys', async (req: Request, res: Response) => {
  const parsed = addKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const { platform } = parsed.data;
  const provider = resolveProvider(platform as Platform);
  if (!provider) {
    res.status(400).json({ error: { message: `Unknown provider "${platform}"`, type: 'invalid_platform' } });
    return;
  }

  const isKeyless = provider.keyless === true;
  const rawKey = parsed.data.key ?? '';
  if (!isKeyless && rawKey.length === 0) {
    res.status(400).json({ error: { message: 'This provider needs an API key', type: 'key_required' } });
    return;
  }

  const db = getDb();
  const label = parsed.data.label ?? '';
  let keyId: number;

  if (isKeyless && rawKey.length === 0) {
    // Keyless providers need exactly one enabled row; re-enabling the existing
    // one keeps the pool from filling with duplicates on repeat clicks.
    const existing = db.prepare("SELECT id FROM api_keys WHERE platform = ? ORDER BY id LIMIT 1")
      .get(platform) as { id: number } | undefined;
    if (existing) {
      db.prepare("UPDATE api_keys SET enabled = 1 WHERE id = ?").run(existing.id);
      keyId = existing.id;
    } else {
      const secret = encrypt('no-key');
      const inserted = db.prepare(`
        INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
        VALUES (?, ?, ?, ?, ?, 'unknown', 1)
      `).run(platform, label, secret.encrypted, secret.iv, secret.authTag);
      keyId = Number(inserted.lastInsertRowid);
    }
  } else {
    const secret = encrypt(rawKey);
    const inserted = db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, 'unknown', 1)
    `).run(platform, label, secret.encrypted, secret.iv, secret.authTag);
    keyId = Number(inserted.lastInsertRowid);
  }

  // Providers whose model list is not in the bundled catalog learn it from the
  // key itself; without this the pool has a credential and nothing to route to.
  triggerBuiltinModelDiscovery(db, platform, 'key_added');

  let status = 'unknown';
  let healthError: string | null = null;
  try {
    status = await checkKeyHealth(keyId);
  } catch (error) {
    healthError = (error as Error)?.message ?? String(error);
  }
  clearCooldownsForKey(keyId);

  const modelCount = (db.prepare('SELECT COUNT(*) AS c FROM models WHERE platform = ? AND enabled = 1')
    .get(platform) as { c: number }).c;

  res.status(201).json({
    key: {
      id: keyId,
      platform,
      label,
      maskedKey: maskKey(isKeyless && rawKey.length === 0 ? 'no-key' : rawKey),
      status,
      enabled: true,
      lastError: healthError,
    },
    modelsAvailable: modelCount,
  });
});

adminRouter.patch('/keys/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: { message: 'Invalid key id' } });
    return;
  }
  const schema = z.object({ enabled: z.boolean().optional(), label: z.string().trim().max(200).optional() });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const db = getDb();
  const existing = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(id) as { id: number } | undefined;
  if (!existing) {
    res.status(404).json({ error: { message: 'No such key' } });
    return;
  }
  const updates: string[] = [];
  const values: (string | number)[] = [];
  if (parsed.data.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(parsed.data.enabled ? 1 : 0);
  }
  if (parsed.data.label !== undefined) {
    updates.push('label = ?');
    values.push(parsed.data.label);
  }
  if (updates.length > 0) {
    db.prepare(`UPDATE api_keys SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
  }
  res.json({ success: true });
});

adminRouter.delete('/keys/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: { message: 'Invalid key id' } });
    return;
  }
  const result = getDb().prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  if (Number(result.changes) === 0) {
    res.status(404).json({ error: { message: 'No such key' } });
    return;
  }
  res.json({ success: true });
});

// ── Accounts ──────────────────────────────────────────────────────────────
adminRouter.get('/users', (_req: Request, res: Response) => {
  res.json({ users: listUsers() });
});

adminRouter.patch('/users/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = z.object({
    role: z.enum(['admin', 'user']).optional(),
    status: z.enum(['active', 'suspended']).optional(),
    apiAccess: z.boolean().optional(),
    dailyLimit: z.number().int().positive().nullable().optional(),
  }).safeParse(req.body ?? {});
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: { message: 'Nothing to update, or an invalid value' } });
    return;
  }
  const me = (req as Request & { user?: { userId: number } }).user;
  const target = getDb().prepare('SELECT id, role FROM users WHERE id = ?').get(id) as
    | { id: number; role: string }
    | undefined;
  if (!target) {
    res.status(404).json({ error: { message: 'No such account' } });
    return;
  }

  const isSelf = me?.userId === id;
  // The three ways to lock a deployment out of its own admin panel. Each is
  // refused with the reason, because the alternative is an operator discovering
  // it after a redeploy.
  if (isSelf && parsed.data.role === 'user') {
    res.status(400).json({
      error: { message: 'You cannot remove your own admin access — ask another admin to do it', type: 'self_demote' },
    });
    return;
  }
  if (isSelf && parsed.data.status === 'suspended') {
    res.status(400).json({ error: { message: 'You cannot suspend your own account', type: 'self_suspend' } });
    return;
  }
  const losingAdmin = target.role === 'admin' &&
    (parsed.data.role === 'user' || parsed.data.status === 'suspended');
  if (losingAdmin && adminCount() <= 1) {
    res.status(400).json({
      error: { message: 'This is the only admin left — promote someone else first', type: 'last_admin' },
    });
    return;
  }

  if (parsed.data.role !== undefined) {
    const result = setUserRole(id, parsed.data.role as Role);
    if (!result.ok) {
      res.status(400).json({ error: { message: result.error, type: 'role_change_rejected' } });
      return;
    }
  }
  if (parsed.data.status !== undefined) setUserStatus(id, parsed.data.status);
  if (parsed.data.apiAccess !== undefined) setUserApiAccess(id, parsed.data.apiAccess);
  if (parsed.data.dailyLimit !== undefined) setUserDailyLimit(id, parsed.data.dailyLimit);

  res.json({
    success: true,
    user: listUsers().find(user => user.id === id) ?? null,
  });
});

// Issue a fresh inference key for an account (a leaked key, a departed
// contractor). Returned once, to the admin, so it can be handed over; the old
// key stops working immediately.
adminRouter.post('/users/:id/rotate-key', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: { message: 'Invalid account id' } });
    return;
  }
  const existing = getDb().prepare('SELECT id FROM users WHERE id = ?').get(id) as { id: number } | undefined;
  if (!existing) {
    res.status(404).json({ error: { message: 'No such account' } });
    return;
  }
  res.json({ apiKey: rotateUserApiKey(id) });
});

// ── Announcements ─────────────────────────────────────────────────────────
adminRouter.get('/announcements', (_req: Request, res: Response) => {
  res.json({ announcements: listAllAnnouncements() });
});

adminRouter.post('/announcements', (req: Request, res: Response) => {
  const parsed = z.object({
    title: z.string().trim().min(1, 'A title is required').max(ANNOUNCEMENT_TITLE_MAX),
    body: z.string().trim().min(1, 'A message is required').max(ANNOUNCEMENT_BODY_MAX),
    level: z.enum(['info', 'success', 'warning']).optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  res.status(201).json({ announcement: createAnnouncement(parsed.data) });
});

adminRouter.patch('/announcements/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = z.object({
    title: z.string().trim().min(1).max(ANNOUNCEMENT_TITLE_MAX).optional(),
    body: z.string().trim().min(1).max(ANNOUNCEMENT_BODY_MAX).optional(),
    level: z.enum(['info', 'success', 'warning']).optional(),
    active: z.boolean().optional(),
  }).safeParse(req.body ?? {});
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: { message: 'Invalid announcement update' } });
    return;
  }
  const updated = updateAnnouncement(id, parsed.data);
  if (!updated) {
    res.status(404).json({ error: { message: 'No such announcement' } });
    return;
  }
  res.json({ announcement: updated });
});

adminRouter.delete('/announcements/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || !deleteAnnouncement(id)) {
    res.status(404).json({ error: { message: 'No such announcement' } });
    return;
  }
  res.json({ success: true });
});

// ── The unguessable URL the panel lives on ────────────────────────────────
adminRouter.get('/path', (_req: Request, res: Response) => {
  res.json({ path: adminPath() });
});

// ── Deployment-wide access settings ───────────────────────────────────────
adminRouter.get('/settings/access', (_req: Request, res: Response) => {
  res.json(accessSettings());
});

adminRouter.patch('/settings/access', (req: Request, res: Response) => {
  const parsed = z.object({
    signupOpen: z.boolean().optional(),
    defaultApiAccess: z.boolean().optional(),
    // null clears the cap; a positive integer sets it.
    defaultDailyLimit: z.number().int().positive().nullable().optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  if (parsed.data.signupOpen !== undefined) setSignupOpen(parsed.data.signupOpen);
  if (parsed.data.defaultApiAccess !== undefined) setDefaultApiAccess(parsed.data.defaultApiAccess);
  if (parsed.data.defaultDailyLimit !== undefined) setDefaultDailyLimit(parsed.data.defaultDailyLimit);
  res.json(accessSettings());
});

// Re-probe one key (the panel's refresh button). Same verdict the periodic
// checker would reach, just without waiting for it.
adminRouter.post('/keys/:id/check', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: { message: 'Invalid key id' } });
    return;
  }
  const existing = getDb().prepare('SELECT id FROM api_keys WHERE id = ?').get(id) as { id: number } | undefined;
  if (!existing) {
    res.status(404).json({ error: { message: 'No such key' } });
    return;
  }
  const status = await checkKeyHealth(id);
  res.json({ status });
});

// ── Probe every provider key now ──────────────────────────────────────────
// The periodic checker runs every few minutes; an operator who just pasted a
// key (or suspects a provider outage) should not have to wait for it.
adminRouter.post('/health/check-all', async (_req: Request, res: Response) => {
  const result = await checkAllKeys({ force: true, manual: true });
  res.json({ success: true, checked: result.checkedKeyIds.length, skipped: result.skippedKeyIds.length });
});

// ── Who am I (used by the panel's header and by isAdminUser consumers) ─────
adminRouter.get('/me', (req: Request, res: Response) => {
  const me = (req as Request & { user?: { userId: number; email: string } }).user;
  if (!me) {
    res.status(401).json({ error: { message: 'Authentication required' } });
    return;
  }
  res.json({ id: me.userId, email: me.email, isAdmin: isAdminSession(me.userId) });
});
