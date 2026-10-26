// @vitest-environment jsdom
// The global notice strip: it reads the public announcement list, shows each
// notice once, and remembers a dismissal instead of reopening on every page.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnnouncementBanner } from './announcement-banner'

const payload = {
  announcements: [
    { id: 7, title: 'Maintenance', body: 'Groq is rate-limited until 18:00 UTC.', level: 'warning', createdAt: '' },
  ],
}

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(async () => payload) }))

let root: Root
let container: HTMLDivElement
beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
beforeEach(() => {
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() => root.render(
    <QueryClientProvider client={client}>
      <AnnouncementBanner />
    </QueryClientProvider>,
  ))
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

it('shows an active announcement with its message', async () => {
  await mount()
  expect(container.textContent).toContain('Maintenance')
  expect(container.textContent).toContain('Groq is rate-limited until 18:00 UTC.')
})

it('remembers a dismissal so the banner does not reopen', async () => {
  await mount()
  const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss announcement"]')!
  act(() => dismiss.click())
  expect(container.textContent).not.toContain('Maintenance')
  expect(window.localStorage.getItem('fluzyai.announcements.dismissed')).toBe('[7]')

  // A fresh mount on the same browser stays quiet.
  act(() => root.unmount())
  root = createRoot(container)
  await mount()
  expect(container.textContent).not.toContain('Maintenance')
})
