import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { createApp, INLINE_BOOTSTRAP_SHA, INLINE_BOOT_SHA } from '../../app.js';
import { initDb } from '../../db/index.js';

// index.html ships inline <script>s that must run before (or when) the bundle
// does not: the theme/direction bootstrap, so dark-mode users do not get a white
// flash, and the boot guard, which paints a splash and turns a failure into
// something a visitor can read instead of an empty page.
//
// `script-src 'self'` blocked the first one on EVERY install, HTTPS included —
// the violation is visible in the console log pasted into #682, where it was
// read as part of the LAN/HTTP problem. It is not: it reproduces on localhost
// too. The second one hit the same wall the moment it was added.
//
// Hash literals in app.ts keep the CSP header a constant string. These tests are
// the guard against drift — and they check EVERY un-sourced <script> in
// index.html, so a third one cannot be added without updating the header.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');

/** All inline (no src) scripts, in document order. */
function inlineScriptsFrom(html: string): string[] {
  const scripts: string[] = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) scripts.push(match[1]!);
  return scripts;
}

function sha256Directive(source: string): string {
  return `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`;
}

function scriptSrcOf(csp: string): string {
  return csp.split(';').find(d => d.trim().startsWith('script-src '))!;
}

describe('CSP allows the inline scripts index.html needs (#682)', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  it('has exactly the two documented inline scripts, with the expected hashes', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'client/index.html'), 'utf8');
    const scripts = inlineScriptsFrom(html);
    expect(scripts, 'inline <script> count changed — update INLINE_*_SHA and this test').toHaveLength(2);
    expect(sha256Directive(scripts[0]!)).toBe(INLINE_BOOTSTRAP_SHA);
    expect(sha256Directive(scripts[1]!)).toBe(INLINE_BOOT_SHA);
  });

  it('matches the built client, when one is present', () => {
    // Vite copies index.html through, but a future plugin could rewrite the
    // inline script — the browser enforces the hash against the BUILT file, so
    // that is the one that really has to match.
    const built = path.join(repoRoot, 'client/dist/index.html');
    if (!fs.existsSync(built)) return;
    const scripts = inlineScriptsFrom(fs.readFileSync(built, 'utf8'));
    expect(scripts.length, 'inline <script> count changed').toBe(2);
    expect(sha256Directive(scripts[0]!)).toBe(INLINE_BOOTSTRAP_SHA);
    expect(sha256Directive(scripts[1]!)).toBe(INLINE_BOOT_SHA);
  });

  it('serves both hashes in the script-src directive', async () => {
    const server = app.listen(0, '127.0.0.1');
    if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const addr = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/ping`);
    server.close();
    const scriptSrc = scriptSrcOf(res.headers.get('content-security-policy')!);
    expect(scriptSrc).toContain(INLINE_BOOTSTRAP_SHA);
    expect(scriptSrc).toContain(INLINE_BOOT_SHA);
  });

  it('still refuses other inline scripts — no unsafe-inline for scripts', async () => {
    const server = app.listen(0, '127.0.0.1');
    if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const addr = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/ping`);
    server.close();
    const scriptSrc = scriptSrcOf(res.headers.get('content-security-policy')!);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });
});
