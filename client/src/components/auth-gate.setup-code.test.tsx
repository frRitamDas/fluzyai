// @vitest-environment jsdom
//
// Remote first-run setup needs the one-time setup code. The form used to show
// the code field only AFTER a submit was rejected, so an operator filling in the
// create-account form on a hosted deployment submitted once, got an error, and
// then discovered a second field existed. /api/auth/status now says whether the
// caller needs the code, and the field is there from the first paint.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '@/i18n'
import { AuthGate } from './auth-gate'

let root: Root
let container: HTMLDivElement
let setupCodeRequired: boolean
let setupResponse: { status: number; body: unknown }
let posts: { url: string; body: Record<string, string> }[]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <I18nProvider initialLocale="en">
          {/* /login: these cases are about the form itself. The signed-out home
              page that now lives at "/" has its own test file. */}
          <MemoryRouter initialEntries={['/login']}>
            <AuthGate><div data-testid="app">dashboard</div></AuthGate>
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    )
  })
}

function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  const form = container.querySelector('form')!
  act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  await flush()
}

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setupCodeRequired = false
  setupResponse = { status: 201, body: { token: 'session-token', email: 'owner@example.com' } }
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/auth/status')) {
      return json({ needsSetup: true, authenticated: false, email: null, setupCodeRequired })
    }
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) })
      return json(setupResponse.body, setupResponse.status)
    }
    return json({ error: { message: `unexpected ${url}` } }, 404)
  }))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('AuthGate first-run setup code', () => {
  it('shows the code field immediately when the server says this browser needs it', async () => {
    setupCodeRequired = true
    mount()
    await flush()

    expect(container.querySelector('#auth-setup-code')).not.toBeNull()
  })

  it('keeps the field hidden on a local first run, where no code is required', async () => {
    mount()
    await flush()

    expect(container.querySelector('#auth-setup-code')).toBeNull()
  })

  it('does not submit a remote first run without the code', async () => {
    setupCodeRequired = true
    mount()
    await flush()
    type('#auth-email', 'owner@example.com')
    type('#auth-password', 'a-long-enough-password')
    await submit()

    expect(posts).toHaveLength(0)
    expect(container.querySelector('#auth-setup-code-error')).not.toBeNull()
  })

  it('sends the code with the account it creates', async () => {
    setupCodeRequired = true
    mount()
    await flush()
    type('#auth-email', 'owner@example.com')
    type('#auth-password', 'a-long-enough-password')
    type('#auth-setup-code', '  ABC12345  ')
    await submit()

    expect(posts).toHaveLength(1)
    expect(posts[0].url.endsWith('/api/auth/register')).toBe(true)
    expect(posts[0].body.setupCode).toBe('ABC12345')
  })
})
