import { useEffect, useState } from 'react'

/**
 * Subscribe to a CSS media query from JavaScript.
 *
 * Only for layout decisions that cannot be expressed in CSS classes — panels
 * that must switch from "a column beside the content" to "a drawer over it",
 * where the difference is not styling but structure. Anything that is purely
 * visual belongs in a `sm:`/`md:` class instead.
 *
 * Returns `false` during server-side rendering and before the first effect, so
 * a page never briefly claims to be mobile on a desktop (or the reverse) because
 * the listener had not attached yet.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const update = (event: MediaQueryListEvent | MediaQueryList) => setMatches(event.matches)
    update(list)
    // Safari < 14 only has the deprecated listener API; everything else has
    // both, and calling addEventListener there throws.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', update)
      return () => list.removeEventListener('change', update)
    }
    list.addListener(update)
    return () => list.removeListener(update)
  }, [query])

  return matches
}

/** True below the `md` breakpoint (767px and narrower) — Tailwind's md = 768px. */
export function useIsCompact(): boolean {
  return useMediaQuery('(max-width: 767px)')
}
