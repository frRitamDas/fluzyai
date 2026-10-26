// @vitest-environment jsdom
// The admin panel: the deployment-wide stats, the account list, and the two
// write flows an operator reaches for most (promote an account, publish a
// notice). The provider picker is a Radix Select, so the add-key path is covered
// by the server suite instead of fighting a portal in jsdom.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/i18n'
import AdminPage from './AdminPage'

const requests: Array<{ path: string; method: string; body?: unknown }> = []

const overview = {
  users: { total: 3, admins: 1 },
  keys: { total: 4, enabled: 3, healthy: 2, platforms: 2 },
  models: { total: 210, enabled: 180 },
  requests: { total: 1200, today: 42 },
  announcements: { active: 0 },
  persistence: {
    configured: true,
    bucket: 'fluzyai-db',
    object: 'fluzyai.db',
    lastRestoreAt: '2026-10-26T19:57:13.206Z',
    lastUploadAt: '2026-10-26T19:57:15.968Z',
    pendingWrite: false,
    lastError: null,
    staleSince: null,
  },
  access: { signupOpen: true, defaultApiAccess: true, defaultDailyLimit: null, suspended: 0, withoutApiAccess: 0 },
}

const users = [
  {
    id: 1, email: 'ritam73592@gmail.com', role: 'admin', status: 'active',
    apiAccess: true, dailyLimit: null, requestsToday: 3,
    createdAt: '2026-10-01 09:00:00', hasApiKey: true,
  },
  {
    id: 2, email: 'someone@example.com', role: 'user', status: 'active',
    apiAccess: true, dailyLimit: null, requestsToday: 0,
    createdAt: '2026-10-02 09:00:00', hasApiKey: false,
  },
]

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(async (path: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET'
    requests.push({ path, method, body: options?.body ? JSON.parse(String(options.body)) : undefined })
    if (path === '/api/admin/overview') return overview
    if (path === '/api/admin/users') return { users }
    if (path === '/api/admin/providers') return { providers: [] }
    if (path === '/api/admin/keys') return { keys: [] }
    if (path === '/api/admin/path') return { path: '/ops-7f3a91c4' }
    if (path === '/api/admin/settings/access') return { signupOpen: true, defaultApiAccess: true, defaultDailyLimit: null }
    if (path === '/api/admin/announcements') {
      return method === 'POST'
        ? { announcement: { id: 1, title: 'Maintenance', body: 'Tonight', level: 'info', active: true, createdAt: '' } }
        : { announcements: [] }
    }
    return {}
  }),
}))

let root: Root
let container: HTMLDivElement
beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
beforeEach(() => {
  requests.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => root.render(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en">
        <AdminPage />
      </I18nProvider>
    </QueryClientProvider>,
  ))
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

const text = () => container.textContent ?? ''

it('shows the deployment stats an operator cares about', async () => {
  await mount()
  expect(text()).toContain('Admin console')
  // Accounts, provider keys, healthy keys, providers, models, requests today.
  expect(text()).toContain('3')
  expect(text()).toContain('210')
  expect(text()).toContain('42')
  expect(requests.map(r => r.path)).toContain('/api/admin/overview')
})

it('lists accounts and promotes one', async () => {
  await mount()
  act(() => {
    ;[...container.querySelectorAll('button')].find(b => b.textContent?.includes('Accounts'))?.click()
  })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })

  expect(text()).toContain('someone@example.com')

  const promote = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Make admin'))
  expect(promote).toBeTruthy()
  act(() => promote!.click())
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })

  const patch = requests.find(r => r.method === 'PATCH')
  expect(patch?.path).toBe('/api/admin/users/2')
  expect(patch?.body).toMatchObject({ role: 'admin' })
})

it('publishes an announcement', async () => {
  await mount()
  act(() => {
    ;[...container.querySelectorAll('button')].find(b => b.textContent?.includes('Announcements'))?.click()
  })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })

  const title = container.querySelector<HTMLInputElement>('#ann-title')!
  const body = container.querySelector<HTMLTextAreaElement>('#ann-body')!
  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setValue.call(title, 'Maintenance')
    title.dispatchEvent(new Event('input', { bubbles: true }))
    const setArea = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setArea.call(body, 'Groq is rate-limited tonight.')
    body.dispatchEvent(new Event('input', { bubbles: true }))
  })

  const publish = [...container.querySelectorAll('button')].find(b => b.textContent === 'Publish')!
  act(() => publish.click())
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })

  const post = requests.find(r => r.method === 'POST' && r.path === '/api/admin/announcements')
  expect(post?.body).toMatchObject({ title: 'Maintenance', body: 'Groq is rate-limited tonight.', level: 'info' })
})
