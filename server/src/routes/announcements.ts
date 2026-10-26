import { Router } from 'express';
import type { Request, Response } from 'express';
import { listActiveAnnouncements } from '../services/announcements.js';

/**
 * The public read side of announcements (the admin CRUD lives in routes/admin).
 *
 * Unauthenticated on purpose: the home page shows the same banner, and "the
 * gateway is offline tonight" is information a visitor should get before
 * creating an account. It exposes only what an admin chose to publish.
 */
export const announcementsRouter = Router();

announcementsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ announcements: listActiveAnnouncements() });
});
