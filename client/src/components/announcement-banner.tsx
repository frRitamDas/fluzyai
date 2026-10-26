import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info, Megaphone, TriangleAlert, X } from 'lucide-react'

import { apiFetch } from '@/lib/api'

/**
 * The global announcement strip.
 *
 * Reads the public /api/announcements (the same list the home page shows), so a
 * notice from the admin panel appears for everyone without a redeploy. Each
 * notice can be dismissed individually and the dismissal is remembered in
 * localStorage — a banner that comes back on every navigation is worse than no
 * banner.
 */
export interface Announcement {
  id: number
  title: string
  body: string
  level: 'info' | 'success' | 'warning'
  createdAt: string
}

const DISMISSED_KEY = 'fluzyai.announcements.dismissed'

function readDismissed(): number[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []
  } catch {
    return []
  }
}

export function useAnnouncements() {
  return useQuery<{ announcements: Announcement[] }>({
    queryKey: ['announcements'],
    queryFn: () => apiFetch('/api/announcements'),
    // A notice is not urgent enough to refetch on every focus, and the admin's
    // own panel invalidates this key when it publishes.
    staleTime: 5 * 60_000,
    retry: false,
  })
}

const TONES: Record<Announcement['level'], { wrap: string; icon: typeof Info }> = {
  info: { wrap: 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-200', icon: Info },
  success: { wrap: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200', icon: Megaphone },
  warning: { wrap: 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200', icon: TriangleAlert },
}

export function AnnouncementBanner({ compact = false }: { compact?: boolean }) {
  const { data } = useAnnouncements()
  const [dismissed, setDismissed] = useState<number[]>(readDismissed)

  const visible = (data?.announcements ?? []).filter(item => !dismissed.includes(item.id))
  if (visible.length === 0) return null

  function dismiss(id: number) {
    const next = [...dismissed, id]
    setDismissed(next)
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable: it will come back next load, which is acceptable */
    }
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2 px-6 pt-4'}>
      {visible.map(item => {
        const tone = TONES[item.level] ?? TONES.info
        const Icon = tone.icon
        return (
          <div key={item.id} role="status" className={`flex items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 ${tone.wrap}`}>
            <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
              <span className="font-medium">{item.title}</span>
              <span className="mx-1.5 opacity-40">·</span>
              {item.body}
            </p>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss announcement"
              className="rounded-md p-0.5 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}
