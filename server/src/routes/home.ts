import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { listActiveAnnouncements } from '../services/announcements.js';
import { accountAccess, requestsToday } from '../services/access.js';
import { roleForUser, userApiKey } from '../services/roles.js';

/**
 * The signed-in home screen's single request.
 *
 * A dashboard landing page needs six unrelated facts — who you are, what your
 * key is, how much you have used it, how many models exist, whether any
 * provider is healthy, and any notice the operator published. Fetching those
 * from six endpoints means six loading states on one screen and a first paint
 * that assembles itself out of whichever answers arrive first. One query, one
 * skeleton, one retry.
 *
 * Everything here is already visible to this account through other endpoints
 * (its own key, the provider catalog), so the route adds no new disclosure: it
 * is a summary, not a wider door. Mounted behind requireAuth.
 */
export const homeRouter = Router();

function count(sql: string): number {
  const row = getDb().prepare(sql).get() as { c: number } | undefined;
  return row?.c ?? 0;
}

interface HomePayload {
  account: {
    email: string;
    role: 'admin' | 'user';
    status: string;
    apiAccess: boolean;
    dailyLimit: number | null;
    requestsToday: number;
  };
  key: { apiKey: string };
  models: { total: number; enabled: number; platforms: number };
  providers: { configured: number; healthy: number; platforms: number };
  requests: { today: number; total: number };
  announcements: ReturnType<typeof listActiveAnnouncements>;
}

homeRouter.get('/', (req: Request, res: Response) => {
  const user = (req as Request & { user?: { userId: number; email: string } }).user;
  if (!user) {
    // requireAuth already answered 401; this keeps the handler honest if the
    // route is ever mounted somewhere else.
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }

  const access = accountAccess(user.userId);
  const payload: HomePayload = {
    account: {
      email: user.email,
      role: roleForUser(user.userId),
      status: access?.status ?? 'active',
      // A missing row would mean the session outlived its account; treat that as
      // "no API access" rather than claiming it works.
      apiAccess: access?.api_access === 1,
      dailyLimit: access?.daily_limit ?? null,
      requestsToday: requestsToday(user.userId),
    },
    key: { apiKey: userApiKey(user.userId) },
    models: {
      total: count('SELECT COUNT(*) AS c FROM models'),
      enabled: count('SELECT COUNT(*) AS c FROM models WHERE enabled = 1'),
      platforms: count('SELECT COUNT(DISTINCT platform) AS c FROM models WHERE enabled = 1'),
    },
    providers: {
      configured: count('SELECT COUNT(*) AS c FROM api_keys WHERE enabled = 1'),
      // 'unknown' has never been probed and is eligible for routing, so it is
      // counted as usable — matching what the router does, not what the label
      // suggests.
      healthy: count("SELECT COUNT(*) AS c FROM api_keys WHERE enabled = 1 AND status IN ('healthy','unknown')"),
      platforms: count('SELECT COUNT(DISTINCT platform) AS c FROM api_keys WHERE enabled = 1'),
    },
    requests: {
      today: count("SELECT COUNT(*) AS c FROM requests WHERE date(created_at) = date('now')"),
      total: count('SELECT COUNT(*) AS c FROM requests'),
    },
    announcements: listActiveAnnouncements(),
  };

  // The home screen renders counts and a key; a stale cached copy of either is
  // worse than a reload. Session-scoped private data must never be shared by a
  // proxy, either.
  res.setHeader('Cache-Control', 'no-store');
  res.json(payload);
});
