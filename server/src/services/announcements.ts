import { getDb } from '../db/index.js';

/**
 * Global announcements.
 *
 * One row per notice, shown to every account as a banner on the dashboard (and
 * to signed-out visitors on the home page). Managed from the admin panel; the
 * read side is public because "the API is down for maintenance" is exactly the
 * kind of thing a visitor should read before signing in.
 *
 * Only `active` rows are returned, newest first, and the list is capped: a
 * banner stack is not a changelog.
 */

export type AnnouncementLevel = 'info' | 'success' | 'warning';

export interface Announcement {
  id: number;
  title: string;
  body: string;
  level: AnnouncementLevel;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const LEVELS: AnnouncementLevel[] = ['info', 'success', 'warning'];

export const ANNOUNCEMENT_BODY_MAX = 600;
export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_LIMIT = 3;

interface Row {
  id: number;
  title: string;
  body: string;
  level: string;
  active: number;
  created_at: string;
  updated_at: string;
}

function toAnnouncement(row: Row): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    level: LEVELS.includes(row.level as AnnouncementLevel) ? (row.level as AnnouncementLevel) : 'info',
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Active notices, newest first, for the banner strip. */
export function listActiveAnnouncements(limit = ANNOUNCEMENT_LIMIT): Announcement[] {
  const rows = getDb().prepare(
    'SELECT * FROM announcements WHERE active = 1 ORDER BY created_at DESC, id DESC LIMIT ?',
  ).all(limit) as Row[];
  return rows.map(toAnnouncement);
}

/** Every notice, including paused ones, for the admin panel. */
export function listAllAnnouncements(): Announcement[] {
  const rows = getDb().prepare('SELECT * FROM announcements ORDER BY created_at DESC, id DESC').all() as Row[];
  return rows.map(toAnnouncement);
}

export function createAnnouncement(input: {
  title: string;
  body: string;
  level?: string;
}): Announcement {
  const level = LEVELS.includes(input.level as AnnouncementLevel) ? input.level! : 'info';
  const result = getDb().prepare(
    'INSERT INTO announcements (title, body, level, active) VALUES (?, ?, ?, 1)',
  ).run(input.title.trim().slice(0, ANNOUNCEMENT_TITLE_MAX), input.body.trim().slice(0, ANNOUNCEMENT_BODY_MAX), level);
  const row = getDb().prepare('SELECT * FROM announcements WHERE id = ?')
    .get(result.lastInsertRowid) as Row;
  return toAnnouncement(row);
}

export function updateAnnouncement(
  id: number,
  patch: { title?: string; body?: string; level?: string; active?: boolean },
): Announcement | null {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as Row | undefined;
  if (!existing) return null;

  const updates: string[] = [];
  const values: (string | number)[] = [];
  if (patch.title !== undefined) {
    updates.push('title = ?');
    values.push(patch.title.trim().slice(0, ANNOUNCEMENT_TITLE_MAX));
  }
  if (patch.body !== undefined) {
    updates.push('body = ?');
    values.push(patch.body.trim().slice(0, ANNOUNCEMENT_BODY_MAX));
  }
  if (patch.level !== undefined && LEVELS.includes(patch.level as AnnouncementLevel)) {
    updates.push('level = ?');
    values.push(patch.level);
  }
  if (patch.active !== undefined) {
    updates.push('active = ?');
    values.push(patch.active ? 1 : 0);
  }
  if (updates.length === 0) return toAnnouncement(existing);

  updates.push("updated_at = datetime('now')");
  db.prepare(`UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
  return toAnnouncement(db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as Row);
}

export function deleteAnnouncement(id: number): boolean {
  const result = getDb().prepare('DELETE FROM announcements WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}
