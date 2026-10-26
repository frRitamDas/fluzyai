import { userCount, createUser } from '../services/auth.js';
import { clearSetupCode, generateSetupCode } from './setup-code.js';

/**
 * First-run bootstrap: how the dashboard gets its first (and only) account.
 *
 * A fresh install has no account, and the only thing that may create one is
 * `POST /api/auth/setup`. Because that endpoint is unauthenticated by
 * necessity, it is gated: a browser on the same machine may claim the install
 * directly, and anything else must present the one-time setup code (see
 * routes/auth.ts). That rule is right for a laptop and awkward for a hosted
 * deployment, where the operator is on a remote browser and the code lives in
 * an environment variable they then have to copy into a form — a step with no
 * security value, because the same operator already controls the variables.
 *
 * So a hosted deployment can instead *declare* its account:
 *
 *   FLUZY_ADMIN_EMAIL=you@example.com
 *   FLUZY_ADMIN_PASSWORD=a-long-password-you-choose
 *
 * When both are present and the users table is still empty, the account is
 * created at boot. The install is claimed before the first request can arrive,
 * so there is no window for a stranger to claim it, no code to copy, and the
 * dashboard starts on "Sign in" instead of "Create your account". The password
 * is hashed into the database and never logged; after the first boot the two
 * variables can be deleted from the platform dashboard (or left, where they act
 * only as a reminder of the original password).
 *
 * Nothing here can take over a claimed install: an existing account makes this
 * a no-op, so a password changed in the dashboard is never reverted at the next
 * cold start.
 */

/** Same minimum as the signup schema in routes/auth.ts. */
const MIN_PASSWORD_LENGTH = 8;

export type AdminSeedResult =
  /** Account created from FLUZY_ADMIN_EMAIL / FLUZY_ADMIN_PASSWORD. */
  | 'created'
  /** An account already exists; the variables (if any) were ignored. */
  | 'exists'
  /** Neither variable is set — the setup-code path stays in charge. */
  | 'unset'
  /** One variable set, or values that would fail the signup schema. */
  | 'invalid';

/**
 * Trimmed environment value, or ''. Deliberate for the password too: a secret
 * pasted into a platform dashboard routinely picks up a trailing newline or
 * space, and a password nobody can type is worse than one with no whitespace.
 */
function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

/** Whether the declared credentials look like something the signup schema would accept. */
function looksUsable(email: string, password: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(email) && password.length >= MIN_PASSWORD_LENGTH;
}

/**
 * Create the dashboard account declared by FLUZY_ADMIN_EMAIL /
 * FLUZY_ADMIN_PASSWORD, if there is no account yet.
 *
 * Idempotent and safe to call on every boot, including from several serverless
 * instances at once: `createUser` refuses a duplicate email, which is treated as
 * "already claimed" rather than as an error worth failing boot over.
 */
export function seedAdminFromEnv(): AdminSeedResult {
  const email = readEnv('FLUZY_ADMIN_EMAIL');
  const password = readEnv('FLUZY_ADMIN_PASSWORD');

  if (!email && !password) return 'unset';

  if (!email || !password) {
    console.warn(
      '[admin] FLUZY_ADMIN_EMAIL and FLUZY_ADMIN_PASSWORD must be set together — ignoring both. ' +
        (email ? 'FLUZY_ADMIN_PASSWORD is missing.' : 'FLUZY_ADMIN_EMAIL is missing.'),
    );
    return 'invalid';
  }

  if (!looksUsable(email, password)) {
    console.warn(
      `[admin] FLUZY_ADMIN_EMAIL must be an email address and FLUZY_ADMIN_PASSWORD at least ` +
        `${MIN_PASSWORD_LENGTH} characters — ignoring both.`,
    );
    return 'invalid';
  }

  if (userCount() > 0) return 'exists';

  try {
    createUser(email, password);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'email_taken') return 'exists';
    // Anything else (a locked database, a half-migrated file) must not cost the
    // operator their fallback: report it and let the setup code take over.
    console.warn(`[admin] could not create the FLUZY_ADMIN_EMAIL account: ${(error as Error)?.message ?? error}`);
    return 'invalid';
  }

  // The install is claimed, so there is no first-run window left to protect.
  clearSetupCode();
  console.log(`[admin] dashboard account created for ${email} (from FLUZY_ADMIN_EMAIL)`);
  return 'created';
}

/**
 * Boot-time first run, shared by the long-running server and the serverless
 * entry. An account declared in the environment is created first; only when
 * that leaves the install unclaimed is the one-time setup code minted (and
 * logged, or taken from FLUZY_SETUP_CODE).
 *
 * Call after initDb() and after applyDeclarativeConfigFromEnv(), whose `admin`
 * entry is another way to declare the first account.
 */
export function firstRunSetup(): void {
  if (userCount() > 0) return;
  if (seedAdminFromEnv() === 'created') return;
  // Another instance may have claimed the install between the two checks.
  if (userCount() > 0) return;
  generateSetupCode();
}
