import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb } from '../../db/index.js';
import { userCount, verifyCredentials } from '../../services/auth.js';
import { seedAdminFromEnv, firstRunSetup } from '../../lib/first-run.js';
import { getSetupCode, clearSetupCode } from '../../lib/setup-code.js';

// First-run bootstrap (lib/first-run.ts): a hosted deployment declares its
// dashboard account in the environment instead of copying a setup code out of
// the boot log and into the first-run form.

const EMAIL = 'owner@example.com';
const PASSWORD = 'correct horse battery';

function clearEnv(): void {
  delete process.env.FLUZY_ADMIN_EMAIL;
  delete process.env.FLUZY_ADMIN_PASSWORD;
  delete process.env.FLUZY_SETUP_CODE;
}

describe('seedAdminFromEnv', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    clearEnv();
    clearSetupCode();
    initDb(':memory:');
  });

  afterEach(() => {
    clearEnv();
    clearSetupCode();
  });

  it('reports "unset" and creates nothing when neither variable is present', () => {
    expect(seedAdminFromEnv()).toBe('unset');
    expect(userCount()).toBe(0);
  });

  it('creates the account from FLUZY_ADMIN_EMAIL / FLUZY_ADMIN_PASSWORD', () => {
    process.env.FLUZY_ADMIN_EMAIL = EMAIL;
    process.env.FLUZY_ADMIN_PASSWORD = PASSWORD;

    expect(seedAdminFromEnv()).toBe('created');
    expect(userCount()).toBe(1);
    // The declared password is the one that works, and it is stored hashed
    // (verifyCredentials would not match a plaintext column).
    expect(verifyCredentials(EMAIL, PASSWORD)?.email).toBe(EMAIL);
    expect(verifyCredentials(EMAIL, 'wrong password')).toBeNull();
  });

  it('is idempotent: a second boot leaves the existing account alone', () => {
    process.env.FLUZY_ADMIN_EMAIL = EMAIL;
    process.env.FLUZY_ADMIN_PASSWORD = PASSWORD;

    expect(seedAdminFromEnv()).toBe('created');
    // A changed variable must not rewrite the stored password (that would undo
    // a password changed in the dashboard at the next cold start).
    process.env.FLUZY_ADMIN_PASSWORD = 'a different password';
    expect(seedAdminFromEnv()).toBe('exists');
    expect(userCount()).toBe(1);
    expect(verifyCredentials(EMAIL, PASSWORD)).not.toBeNull();
    expect(verifyCredentials(EMAIL, 'a different password')).toBeNull();
  });

  it('normalizes the declared email the way signup and login do', () => {
    process.env.FLUZY_ADMIN_EMAIL = '  Owner@Example.COM  ';
    process.env.FLUZY_ADMIN_PASSWORD = PASSWORD;

    expect(seedAdminFromEnv()).toBe('created');
    expect(verifyCredentials('owner@example.com', PASSWORD)?.email).toBe('owner@example.com');
  });

  it('trims a pasted secret so a trailing newline cannot lock the operator out', () => {
    process.env.FLUZY_ADMIN_EMAIL = EMAIL;
    process.env.FLUZY_ADMIN_PASSWORD = `${PASSWORD}\n`;

    expect(seedAdminFromEnv()).toBe('created');
    expect(verifyCredentials(EMAIL, PASSWORD)).not.toBeNull();
  });

  it('rejects half a configuration rather than guessing', () => {
    process.env.FLUZY_ADMIN_EMAIL = EMAIL;
    expect(seedAdminFromEnv()).toBe('invalid');
    expect(userCount()).toBe(0);

    delete process.env.FLUZY_ADMIN_EMAIL;
    process.env.FLUZY_ADMIN_PASSWORD = PASSWORD;
    expect(seedAdminFromEnv()).toBe('invalid');
    expect(userCount()).toBe(0);
  });

  it('rejects values the signup schema would reject', () => {
    process.env.FLUZY_ADMIN_EMAIL = 'not-an-email';
    process.env.FLUZY_ADMIN_PASSWORD = PASSWORD;
    expect(seedAdminFromEnv()).toBe('invalid');

    process.env.FLUZY_ADMIN_EMAIL = EMAIL;
    process.env.FLUZY_ADMIN_PASSWORD = 'short';
    expect(seedAdminFromEnv()).toBe('invalid');
    expect(userCount()).toBe(0);
  });
});

describe('firstRunSetup', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    clearEnv();
    clearSetupCode();
    initDb(':memory:');
  });

  afterEach(() => {
    clearEnv();
    clearSetupCode();
  });

  it('mints the one-time setup code when no account is declared', () => {
    firstRunSetup();
    expect(getSetupCode()).toEqual(expect.any(String));
    expect(getSetupCode()!.length).toBeGreaterThanOrEqual(8);
    expect(userCount()).toBe(0);
  });

  it('claims the install from the environment and clears the setup code', () => {
    process.env.FLUZY_ADMIN_EMAIL = EMAIL;
    process.env.FLUZY_ADMIN_PASSWORD = PASSWORD;

    firstRunSetup();

    expect(userCount()).toBe(1);
    // No unauthenticated first-run window is left open, so no code is needed
    // (or advertised) at all.
    expect(getSetupCode()).toBeNull();
  });

  it('does nothing on a claimed install, even with variables set', () => {
    process.env.FLUZY_ADMIN_EMAIL = EMAIL;
    process.env.FLUZY_ADMIN_PASSWORD = PASSWORD;
    firstRunSetup();

    process.env.FLUZY_ADMIN_EMAIL = 'someone-else@example.com';
    firstRunSetup();

    expect(userCount()).toBe(1);
    expect(verifyCredentials('someone-else@example.com', PASSWORD)).toBeNull();
  });
});
