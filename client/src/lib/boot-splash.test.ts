// @vitest-environment jsdom
// The boot splash is the last line of defence against the failure that shipped:
// an app that renders nothing leaves the visitor staring at the page background
// with no explanation. index.html paints the splash and arms a watchdog;
// these are the rules it relies on.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bootSplashDismissed, dismissBootSplash, scheduleBootSplashDismissal } from './boot-splash'

// App.test.ts resolves sources the same way: process.cwd() is client/ under
// vitest, so plain relative paths are stable.
const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8')
const mainTsx = fs.readFileSync(path.resolve(process.cwd(), 'src/main.tsx'), 'utf8')

function mountShell({ rendered }: { rendered: boolean }) {
  document.body.innerHTML =
    '<div id="fluzy-boot"><div class="fluzy-boot__box"><span>Fluzy AI</span></div></div>' +
    `<div id="root">${rendered ? '<div>app</div>' : ''}</div>`
}

beforeEach(() => {
  ;(window as unknown as { __FLUZY_BOOTED__?: boolean }).__FLUZY_BOOTED__ = false
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

it('keeps the splash while nothing has rendered', () => {
  mountShell({ rendered: false })
  expect(dismissBootSplash()).toBe(false)
  expect(document.getElementById('fluzy-boot')).not.toBeNull()
  expect(bootSplashDismissed()).toBe(false)
})

it('removes the splash once the app has rendered', () => {
  mountShell({ rendered: true })
  expect(dismissBootSplash()).toBe(true)
  expect(document.getElementById('fluzy-boot')).toBeNull()
  expect(bootSplashDismissed()).toBe(true)
})

it('still dismisses a splash that a later retry finds rendered', async () => {
  vi.useFakeTimers()
  mountShell({ rendered: false })
  scheduleBootSplashDismissal()
  expect(document.getElementById('fluzy-boot')).not.toBeNull()

  // React commits a moment later (a slow provider, a suspended boundary).
  document.getElementById('root')!.innerHTML = '<div>app</div>'
  vi.advanceTimersByTime(1_000)
  expect(document.getElementById('fluzy-boot')).toBeNull()
})

it('ships a watchdog, an error card and a cache-busting reload', () => {
  // The splash markup and the failure path live in index.html because it has to
  // work when no module executes at all.
  expect(indexHtml).toContain("splash.id = 'fluzy-boot'")
  // Support/deploy marker: present when the guard actually ran. Its absence on a
  // live page means the CSP did not carry this script's hash.
  expect(indexHtml).toContain("setAttribute('data-fluzy-boot', 'armed')")
  expect(indexHtml).toContain('#fluzy-boot')
  expect(indexHtml).toContain('__FLUZY_BOOT_FAILED__')
  expect(indexHtml).toContain('__FLUZY_BOOT_ERROR__')
  expect(indexHtml).toMatch(/setTimeout\(fail,\s*9000\)/)
  expect(indexHtml).toContain('boot=')
  // A browser that cannot parse the bundle is exactly the case this covers, so
  // the inline script must be ES5: no arrow functions, no let/const, no template
  // literals, no optional chaining.
  const start = indexHtml.indexOf('(function () {')
  const bootScript = indexHtml.slice(start, indexHtml.indexOf('</script>', start))
  expect(bootScript.length).toBeGreaterThan(500)
  expect(bootScript).not.toMatch(/=>/)
  expect(bootScript).not.toMatch(/\b(let|const)\s/)
  expect(bootScript).not.toMatch(/`/)
  expect(bootScript).not.toMatch(/\?\./)
})

it('reloads once when a redeploy invalidates a chunk', () => {
  expect(mainTsx).toContain('vite:preloadError')
  expect(mainTsx).toContain('scheduleBootSplashDismissal()')
})
