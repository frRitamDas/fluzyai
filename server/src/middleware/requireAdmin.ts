import type { Request, Response, NextFunction } from 'express';
import { isAdminSession } from '../services/roles.js';

/**
 * Gate the admin panel behind an admin session. Assumes requireAuth has already
 * run (it is mounted ahead of this one on every admin path), so the session is
 * known-good here and only the role is in question.
 *
 * 403 rather than 404: a signed-in non-admin is not a stranger, and telling them
 * "this deployment has one owner" is more useful than pretending the panel does
 * not exist. Nothing secret is in the response.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as Request & { user?: { userId: number } }).user;
  if (!user) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  if (!isAdminSession(user.userId)) {
    res.status(403).json({
      error: {
        message: 'The admin panel is limited to this deployment\'s owner.',
        type: 'admin_required',
      },
    });
    return;
  }
  next();
}
