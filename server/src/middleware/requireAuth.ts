import type { Request, Response, NextFunction } from 'express';
import { validateSession } from '../services/auth.js';
import { accountAccess } from '../services/access.js';

// Gate the /api/* admin surface behind a dashboard session (#35, item #2).
// The token is the opaque session token issued by /api/auth/login|setup, sent
// as `Authorization: Bearer <token>`. The /v1 proxy is NOT gated by this — it
// keeps its own unified-API-key auth for app clients.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.headers['x-dashboard-token'] as string | undefined);
  const session = validateSession(token);
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  // A suspended account is signed out of every dashboard surface, not just the
  // panel: suspension is the "stop this person without deleting their data"
  // lever, and a live session that kept working would defeat it. Desktop has one
  // hidden local account and no operator to unsuspend it, so it is exempt.
  if (process.env.FLUZY_DESKTOP !== '1' && accountAccess(session.userId)?.status === 'suspended') {
    res.status(403).json({
      error: { message: 'This account is suspended. Contact the deployment admin.', type: 'account_suspended' },
    });
    return;
  }
  (req as Request & { user?: typeof session }).user = session;
  next();
}
