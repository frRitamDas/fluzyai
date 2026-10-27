// @vitest-environment jsdom
// On a phone the conversation rail is a drawer, not a column: closed it costs
// the transcript nothing at all, open it floats over the chat with a backdrop
// that closes it. These are the three things that make a 360px Playground usable.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nProvider } from '@/i18n'
import { ConversationSidebar } from './conversation-sidebar'

let root: Root
let container: HTMLDivElement
const onToggle = vi.fn()
const onSelect = vi.fn()

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
beforeEach(() => {
  onToggle.mockReset()
  onSelect.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(open: boolean, overlay: boolean) {
  act(() =>
    root.render(
      <I18nProvider initialLocale="en">
        <ConversationSidebar
          conversations={[
            { id: 1, title: 'First chat', messageCount: 2, model: 'auto', createdAt: 0, updatedAt: 0 },
            { id: 2, title: 'Second chat', messageCount: 4, model: 'auto', createdAt: 0, updatedAt: 0 },
          ]}
          activeId={1}
          open={open}
          overlay={overlay}
          onToggle={onToggle}
          onNew={() => {}}
          onSelect={onSelect}
          onRename={() => {}}
          onDelete={() => {}}
        />
      </I18nProvider>,
    ),
  )
}

it('renders nothing at all when closed as a drawer', () => {
  render(false, true)
  expect(container.innerHTML).toBe('')
})

it('lays the open drawer over the chat with a closing backdrop', () => {
  render(true, true)
  const html = container.innerHTML
  expect(html).toContain('fixed inset-y-0')
  expect(html).toContain('w-[min(17rem,85vw)]')
  // The backdrop is the tap-to-close surface a phone user reaches for first.
  const backdrop = container.querySelector<HTMLButtonElement>('button.fixed.inset-0')
  expect(backdrop).not.toBeNull()
  act(() => backdrop!.click())
  expect(onToggle).toHaveBeenCalledTimes(1)
})

it('draws the conversation list inside the drawer', () => {
  render(true, true)
  expect(container.textContent).toContain('First chat')
  expect(container.textContent).toContain('Second chat')
})

it('keeps the collapsed strip when it is a column', () => {
  render(false, false)
  // A desktop collapse leaves the 44px strip (new chat + expand) behind.
  expect(container.innerHTML).toContain('w-11')
  expect(container.innerHTML).not.toContain('fixed inset-y-0')
})
