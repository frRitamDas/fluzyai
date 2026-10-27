import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { RootBoundary } from './components/root-boundary'
import { scheduleBootSplashDismissal } from './lib/boot-splash'

// A deploy replaces every hashed asset, so a tab that was open (or a cached
// index.html) can ask for a chunk that no longer exists. Vite reports that here;
// one reload later the page is consistent. Guarded so a genuinely broken build
// cannot loop.
window.addEventListener('vite:preloadError', () => {
  const key = 'fluzyai.reloadedForNewBuild'
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  window.location.reload()
})

const container = document.getElementById('root')
if (!container) {
  // index.html always ships #root; if it is missing the document is not ours
  // (an interposed captive portal, a proxy error page). Say so instead of
  // throwing into the void.
  document.body.innerHTML =
    '<div style="padding:24px;font-family:system-ui,sans-serif">Fluzy AI could not find its mount point (#root). Reload the page.</div>'
} else {
  createRoot(container).render(
    <StrictMode>
      {/* Above the providers on purpose: see components/root-boundary.tsx. */}
      <RootBoundary>
        <App />
      </RootBoundary>
    </StrictMode>,
  )

  // Returns true as soon as React has put something inside #root. Until then the
  // splash from index.html stays up — a deliberate "Loading…" instead of a blank
  // screen, and the watchdog there turns it into an error card if the app never
  // gets this far.
  scheduleBootSplashDismissal()
}
