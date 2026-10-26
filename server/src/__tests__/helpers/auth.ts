import { createUser, createSession } from '../../services/auth.js';
import { setFirstAdmin } from '../../services/roles.js';

// Dashboard /api/* routes are gated by requireAuth (#35). Tests mint a session
// token once (after initDb) and attach it to gated requests.

export function mintDashboardToken(email = 'test@example.com'): string {
  const user = createUser(email, 'password123');
  // The dashboard session these suites act as is the deployment operator — the
  // account that owns the shared provider pool. Ordinary accounts cannot add or
  // remove provider keys (see the admin suites for that boundary).
  setFirstAdmin(user.userId);
  return createSession(user.userId);
}

// Gated = under /api/ but not the public bootstrap routes (/api/auth/*, /api/ping).
export function isGatedApiPath(path: string): boolean {
  return path.startsWith('/api/') && !path.startsWith('/api/auth') && path !== '/api/ping';
}
