import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api'

/**
 * The home screen's one request.
 *
 * Kept separate from the pages that write (Keys, Fallback) because it is read
 * once per visit: no polling, no invalidation storms, 30 s of staleness is
 * plenty for counts and a key that only changes when you rotate it.
 */
export interface HomeSummary {
  account: {
    email: string
    role: 'admin' | 'user'
    status: string
    apiAccess: boolean
    dailyLimit: number | null
    requestsToday: number
  }
  key: { apiKey: string }
  models: { total: number; enabled: number; platforms: number }
  providers: { configured: number; healthy: number; platforms: number }
  requests: { today: number; total: number }
  announcements: { id: number; title: string; body: string; level: string; createdAt: string }[]
}

export function useHome() {
  return useQuery<HomeSummary>({
    queryKey: ['home'],
    queryFn: () => apiFetch<HomeSummary>('/api/home'),
    staleTime: 30_000,
    retry: 1,
  })
}
