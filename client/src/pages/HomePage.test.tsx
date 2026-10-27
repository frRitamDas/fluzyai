// @vitest-environment jsdom
// The signed-in home screen: one request, one loading state, and the four
// things a person actually needs to see (key, endpoint, health, next step).
// Also pins the states that used to be silent: no provider configured, API
// access switched off, and a failed summary.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import HomePage from './HomePage'
import type { HomeSummary } from '@/hooks/use-home'

const KEY = 'fla_' + 'a1b2c3d4'.repeat(8)

const summary = (over: Partial<HomeSummary> = {}): HomeSummary => ({
  account: {
    email: 'rita@example.com',
    role: 'user',
    status: 'active',
    apiAccess: true,
    dailyLimit: 100,
    requestsToday: 12,
  },
  key: { apiKey: KEY },
  models: { total: 40, enabled: 12, platforms: 3 },
  providers: { configured: 2, healthy: 2, platforms: 3 },
  requests: { today: 30, total: 1234 },
  announcements: [],
  ...over,
})

const state = vi.hoisted(() => ({
  home: null as unknown,
  fail: false,
  admin: false,
}))

// The clipboard is stubbed so the copy control can be clicked: the whole key
// must reach it even though only the masked form is ever painted.
const clipboard = vi.hoisted(() => ({ copied: [] as string[] }))
vi.mock('@/lib/clipboard', () => ({
  copyText: async (text: string) => {
    clipboard.copied.push(text)
    return true
  },
}))

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path === '/api/home') {
      if (state.fail) throw new Error('boom')
      return state.home
    }
    if (path === '/api/admin/me') return { isAdmin: state.admin }
    if (path === '/api/admin/path') return { path: '/ops-7f3a91c4' }
    return {}
  }),
}))

let root: Root
let container: HTMLDivElement
beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
beforeEach(() => {
  state.fail = false
  state.admin = false
  state.home = summary()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nProvider initialLocale="en">
          <MemoryRouter initialEntries={['/']}>
            <HomePage />
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    ),
  )
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

const text = () => container.textContent ?? ''
const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`)

it('renders the account, the masked key and the endpoint', async () => {
  await mount()
  expect(text()).toContain('Welcome back, rita')
  expect(text()).toContain('12 / 100') // requests used against the daily cap
  expect(text()).toContain('12') // models enabled
  expect(text()).toContain('2 / 2') // providers healthy / configured
  expect(text()).toContain('/v1')
  expect(text()).toContain('OpenAI-compatible')
})

it('never puts the whole key on screen, but copies it whole', async () => {
  clipboard.copied.length = 0
  await mount()
  // Masked: the middle is elided, the last four characters survive.
  expect(text()).not.toContain(KEY)
  expect(text()).toContain('•')
  expect(text()).toContain(KEY.slice(-4))

  const copy = byLabel('Copy API key') as HTMLButtonElement | null
  expect(copy).not.toBeNull()
  await act(async () => {
    copy!.click()
    await new Promise(r => setTimeout(r, 0))
  })
  // What reaches the clipboard is the real value, not the masked one.
  expect(clipboard.copied).toEqual([KEY])
})

it('warns when no provider is configured', async () => {
  state.home = summary({
    providers: { configured: 0, healthy: 0, platforms: 0 },
    models: { total: 0, enabled: 0, platforms: 0 },
  })
  await mount()
  expect(text()).toContain('No provider key is enabled yet')
  expect(text()).toContain('None configured')
})

it('says so when API access is off for the account', async () => {
  state.home = summary({
    account: {
      email: 'rita@example.com',
      role: 'user',
      status: 'active',
      apiAccess: false,
      dailyLimit: null,
      requestsToday: 0,
    },
  })
  await mount()
  expect(text()).toContain('API access is turned off')
  expect(text()).toContain('unlimited')
})

it('surfaces administrator notices above the counts', async () => {
  state.home = summary({
    announcements: [
      { id: 1, title: 'Scheduled maintenance', body: 'Tonight at 02:00 UTC.', level: 'warning', createdAt: '' },
    ],
  })
  await mount()
  expect(text()).toContain('Scheduled maintenance')
  expect(text()).toContain('Tonight at 02:00 UTC.')
})

it('offers the admin console only to an admin', async () => {
  await mount()
  expect(text()).not.toContain('Admin console')

  act(() => root.unmount())
  container.remove()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  state.admin = true
  await mount()
  expect(text()).toContain('Admin console')
})

it('shows a retry instead of a blank page when the summary fails', async () => {
  state.fail = true
  state.home = null
  await mount()
  // useHome retries once after the default backoff, so the error state lands a
  // beat later than the first response; poll rather than assume a fixed tick.
  for (let i = 0; i < 60 && !text().includes('Could not load your dashboard'); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 100)) })
  }
  expect(text()).toContain('Could not load your dashboard')
  expect(text()).toContain('Try again')
})
