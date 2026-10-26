// @vitest-environment jsdom
//
// The signed-out experience: a real home page that introduces Fluzy AI, with
// Sign in / Create account reachable from the top of it, and the two auth routes
// behind those buttons. Before this the dashboard dropped every visitor straight
// onto a single form with no explanation of what they were signing in to.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '@/i18n'
import { AuthGate } from './auth-gate'

let root: Root
let container: HTMLDivElement
let status: Record<string, unknown>

function json(body: unknown, status_ = 200): Response {
  return new Response(JSON.stringify(body), { status: status_, headers: { 'Content-Type': 'application/json' } })
}

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <I18nProvider initialLocale="en">
          <MemoryRouter initialEntries={[path]}>
            <AuthGate><div data-testid="app">dashboard</div></AuthGate>
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    )
  })
}

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  status = { needsSetup: false, setupCodeRequired: false, signupEnabled: false, authenticated: false, email: null }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/auth/status')) return json(status)
    return json({ error: { message: `unexpected ${url}` } }, 404)
  }))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('signed-out home page', () => {
  it('introduces the product instead of showing a login form', async () => {
    mount('/')
    await flush()

    expect(container.textContent).toContain('One API key')
    expect(container.textContent).toContain('Ritam Das')
    expect(container.querySelector('#auth-email')).toBeNull()
  })

  it('puts Sign in and Create account at the top of the page', async () => {
    mount('/')
    await flush()

    const header = container.querySelector('header')!
    const links = [...header.querySelectorAll('a')].map(a => a.getAttribute('href'))
    expect(links).toContain('/login')
    expect(links).toContain('/signup')
    expect(header.textContent).toContain('Sign in')
    expect(header.textContent).toContain('Create account')
  })

  it('sends a deep link nobody is signed in for to the home page', async () => {
    mount('/analytics')
    await flush()

    expect(container.textContent).toContain('One API key')
  })

  it('offers the create-account form first on a fresh deployment', async () => {
    status = { ...status, needsSetup: true, signupEnabled: true, setupCodeRequired: true }
    mount('/login')
    await flush()

    // /login on an unclaimed install is the create-account form, with the code
    // field already present because this browser is remote.
    expect(container.querySelector('#auth-email')).not.toBeNull()
    expect(container.querySelector('#auth-setup-code')).not.toBeNull()
  })
})

describe('auth routes', () => {
  it('shows both options on the sign-in page of a claimed install', async () => {
    mount('/login')
    await flush()

    expect(container.querySelector('#auth-email')).not.toBeNull()
    const tabs = [...container.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)
    expect(tabs).toEqual(['Sign in', 'Create account'])
  })

  it('explains the single-owner rule instead of a form that would be rejected', async () => {
    status = { ...status, signupEnabled: false }
    mount('/signup')
    await flush()

    expect(container.textContent).toContain('already claimed')
    expect(container.querySelector('#auth-email')).toBeNull()
    // The panel offers the way forward rather than a dead end.
    expect([...container.querySelectorAll('a')].map(a => a.getAttribute('href'))).toContain('/login')
  })

  it('shows the create-account form when the operator enabled signups', async () => {
    status = { ...status, signupEnabled: true }
    mount('/signup')
    await flush()

    expect(container.querySelector('#auth-email')).not.toBeNull()
    expect(container.textContent).toContain('Create your account')
  })
})
