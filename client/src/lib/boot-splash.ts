/**
 * The boot splash painted by index.html (see the comment there).
 *
 * It is removed only once React has actually put something on the page, so a
 * page that never renders keeps its "could not start" card instead of turning
 * into an empty screen. `window.__FLUZY_BOOTED__` is also what the watchdog in
 * index.html reads to decide whether to escalate.
 */

type BootWindow = Window & { __FLUZY_BOOTED__?: boolean }

/** True once the splash has been dismissed at least once. */
export function bootSplashDismissed(): boolean {
  return (window as BootWindow).__FLUZY_BOOTED__ === true
}

/**
 * Remove the splash if the app has rendered something. Returns whether the
 * page is now considered booted.
 *
 * Called from a few places on purpose: the first frame after mount, a couple of
 * timers (a background tab throttles requestAnimationFrame, and a user who
 * switches to the tab should not have to wait for it), and componentDidMount of
 * the root boundary.
 */
export function dismissBootSplash(): boolean {
  if (typeof document === 'undefined') return false
  const root = document.getElementById('root')
  const rendered = !!root && root.childElementCount > 0
  if (!rendered) return bootSplashDismissed()

  const splash = document.getElementById('fluzy-boot')
  if (splash?.parentNode) splash.parentNode.removeChild(splash)
  ;(window as BootWindow).__FLUZY_BOOTED__ = true
  return true
}

/**
 * Try again a few times, then give up: index.html's watchdog owns the failure
 * path, and re-adding a splash that was legitimately dismissed would be worse
 * than leaving the page as it is.
 */
export function scheduleBootSplashDismissal(): void {
  const attempt = (): void => {
    dismissBootSplash()
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(attempt)
  for (const delay of [300, 1_000, 3_000]) setTimeout(attempt, delay)
}
