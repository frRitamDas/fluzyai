// @vitest-environment jsdom
// The whole app, mounted the way a browser mounts it.
//
// Every other client test renders a component in isolation, so a mistake in the
// provider tree — a hook that reads a context from above the provider that is
// supposed to supply it — passes the suite and blanks the deployed site. It did:
// `useAdminPath()` was called in App() itself, one level above
// <QueryClientProvider>, and every route rendered as nothing at all. A throw
// during that first render unmounts the tree, so the browser shows the page
// background and no content: a completely black screen with no error a visitor
// can read or report.
//
// This test therefore asserts on what a visitor sees at "/" and "/login", not on
// internals. If the app cannot render, it fails here instead of in production.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'

const AUTH_STATUS = {
  needsSetup: false,
  setupCodeRequired: false,
  signupEnabled: true,
  authenticated: false,
  email: null,
  role: null,
  isAdmin: false,
  desktop: false,
}

const responses: Record<string, unknown> = {
  '/api/auth/status': AUTH_STATUS,
  '/api/admin/me': { isAdmin: false },
  '/api/admin/path': { path: '/ops-test' },
  '/api/announcements': { announcements: [] },
}

let root: Root
let container: HTMLDivElement
const errors: string[] = []

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  errors.length = 0
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')

  // jsdom has no matchMedia, and the theme provider reads it on mount.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    const body = responses[path] ?? {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }))

  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })
  cleanupSpies.push(spy)

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

const cleanupSpies: { mockRestore: () => void }[] = []

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  for (const spy of cleanupSpies.splice(0)) spy.mockRestore()
})

async function mount(path: string) {
  window.history.replaceState({}, '', path)
  act(() => root.render(<App />))
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  return container.textContent ?? ''
}

it('renders the public home page instead of a blank screen', async () => {
  const text = await mount('/')
  expect(text).toContain('Fluzy AI')
  expect(text).toContain('One API key.')
  // Sign in and Create account are the two actions the home page must offer.
  expect(text).toMatch(/Sign in/)
  expect(text).toMatch(/Create account/)
  expect(errors.join('\n')).not.toMatch(/QueryClient/)
})

it('renders the sign-in form', async () => {
  const text = await mount('/login')
  expect(text).toMatch(/Sign in|Welcome back|Email/i)
  expect(errors.join('\n')).not.toMatch(/QueryClient/)
})

it('renders the not-found page rather than the console', async () => {
  const text = await mount('/ops-test')
  // Not an admin: the console route does not exist, so its path is a 404.
  expect(text).not.toContain('Providers & keys')
})
