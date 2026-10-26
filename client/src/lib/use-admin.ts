import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api'

/**
 * Whether the signed-in session may administer this deployment.
 *
 * Reads /api/admin/me, which answers 403 for ordinary accounts — so the query is
 * expected to fail for most people and must not raise a toast or retry. The
 * answer decides what the UI OFFERS; the server decides what it ALLOWS (every
 * /api/admin route and every write to /api/keys is gated independently).
 */
export function useAdminStatus(): { isAdmin: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery<{ isAdmin: boolean }>({
    queryKey: ['admin-me'],
    queryFn: () => apiFetch<{ isAdmin: boolean }>('/api/admin/me'),
    retry: false,
    staleTime: 5 * 60_000,
    meta: { silenceToast: true },
  })
  return { isAdmin: data?.isAdmin === true, isLoading }
}

/**
 * The unguessable path the admin console is served on.
 *
 * The route is not in the bundle: the app asks the server which path to render
 * the panel at, so typing /admin (or guessing anything else) lands on the
 * ordinary not-found page. This is not the security boundary — the session's
 * role is — it only keeps strangers from finding the console to probe at all.
 */
export function useAdminPath(): string | null {
  const { isAdmin } = useAdminStatus()
  const { data } = useQuery<{ path: string }>({
    queryKey: ['admin-path'],
    queryFn: () => apiFetch<{ path: string }>('/api/admin/path'),
    enabled: isAdmin,
    retry: false,
    staleTime: Infinity,
    meta: { silenceToast: true },
  })
  return isAdmin ? data?.path ?? null : null
}
