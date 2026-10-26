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
