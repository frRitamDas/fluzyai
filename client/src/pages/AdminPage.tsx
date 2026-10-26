import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Database,
  Gauge,
  KeyRound,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react'

import { apiFetch } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * The admin console.
 *
 * One person runs the deployment; everyone else uses it. Everything here is
 * deployment-wide: the shared provider pool, who may call it and how much, the
 * accounts, and the banner. A key added here is the same `api_keys` row the
 * router reads, so it is live for every account on the next request — no
 * publish step, no second code path.
 *
 * Rendered on an unguessable path (see useAdminPath) and gated by the server on
 * every request; hiding it is convenience, requireAdmin is the control.
 */

type Tab = 'overview' | 'providers' | 'accounts' | 'announcements' | 'settings'

interface Persistence {
  configured: boolean
  bucket: string | null
  object: string | null
  lastRestoreAt: string | null
  lastUploadAt: string | null
  pendingWrite: boolean
  lastError: string | null
  staleSince: string | null
}

interface Overview {
  users: { total: number; admins: number }
  keys: { total: number; enabled: number; healthy: number; platforms: number }
  models: { total: number; enabled: number }
  requests: { total: number; today: number }
  announcements: { active: number }
  persistence: Persistence
  access: { signupOpen: boolean; defaultApiAccess: boolean; defaultDailyLimit: number | null; suspended: number; withoutApiAccess: number }
}

interface ProviderOption {
  platform: string
  name: string
  keyless: boolean
  kind: 'chat' | 'search'
  keyCount: number
  enabledKeyCount: number
  modelCount: number
}

interface PoolKey {
  id: number
  platform: string
  label: string
  maskedKey: string
  status: string
  enabled: boolean
  createdAt: string
  lastCheckedAt: string | null
  lastError: string | null
}

interface UserRow {
  id: number
  email: string
  role: 'admin' | 'user'
  status: 'active' | 'suspended'
  apiAccess: boolean
  dailyLimit: number | null
  requestsToday: number
  createdAt: string
  hasApiKey: boolean
}

interface Announcement {
  id: number
  title: string
  body: string
  level: 'info' | 'success' | 'warning'
  active: boolean
  createdAt: string
}

// ── Small shared pieces ───────────────────────────────────────────────────

function Section({ title, hint, action, children }: {
  title: React.ReactNode
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-3xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1 font-heading text-2xl font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function StatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  if (!enabled) {
    return <Badge variant="outline" className="h-5 border-amber-500/40 text-amber-600 dark:text-amber-400">off</Badge>
  }
  const tone =
    status === 'healthy'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : status === 'invalid' || status === 'error'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-border text-muted-foreground'
  return <Badge variant="outline" className={`h-5 ${tone}`}>{status}</Badge>
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading flex items-center gap-2 text-xl font-semibold tracking-tight">
          <ShieldCheck className="size-5" aria-hidden />
          Admin console
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your provider keys, who can use them, and what everyone sees. Changes apply to every account immediately.
        </p>
      </header>

      <SegmentedControl<Tab>
        value={tab}
        onValueChange={setTab}
        ariaLabel="Admin sections"
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'providers', label: 'Providers & keys' },
          { value: 'accounts', label: 'Accounts' },
          { value: 'announcements', label: 'Announcements' },
          { value: 'settings', label: 'Access & settings' },
        ]}
      />

      {tab === 'overview' && <OverviewTab onOpenProviders={() => setTab('providers')} />}
      {tab === 'providers' && <ProvidersTab />}
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'announcements' && <AnnouncementsTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────

function OverviewTab({ onOpenProviders }: { onOpenProviders: () => void }) {
  const queryClient = useQueryClient()
  const overview = useQuery<Overview>({
    queryKey: ['admin-overview'],
    queryFn: () => apiFetch('/api/admin/overview'),
  })

  const probeAll = useMutation({
    mutationFn: () => apiFetch<{ checked: number }>('/api/admin/health/check-all', { method: 'POST' }),
    onSuccess: result => {
      toast.success(`Probed ${result.checked} key${result.checked === 1 ? '' : 's'}`)
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
      queryClient.invalidateQueries({ queryKey: ['admin-keys'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const data = overview.data
  const p = data?.persistence

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Accounts" value={data?.users.total ?? '—'} hint={`${data?.users.admins ?? '—'} admin`} />
        <Stat label="Provider keys" value={data?.keys.total ?? '—'} hint={`${data?.keys.enabled ?? '—'} on`} />
        <Stat label="Healthy" value={data?.keys.healthy ?? '—'} hint="last probe ok" />
        <Stat label="Models live" value={data?.models.enabled ?? '—'} hint={`${data?.models.total ?? '—'} known`} />
        <Stat label="Requests today" value={data?.requests.today ?? '—'} hint={`${data?.requests.total ?? '—'} all time`} />
        <Stat
          label="Suspended"
          value={data?.access?.suspended ?? '—'}
          hint={`${data?.access?.withoutApiAccess ?? '—'} without API`}
          tone={(data?.access?.suspended ?? 0) > 0 ? 'warn' : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Provider pool"
          hint="What every account can call right now."
          action={
            <Button size="sm" variant="outline" onClick={onOpenProviders}>
              <Plus className="size-3.5" /> Add a key
            </Button>
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <Badge variant="outline">{data?.keys.platforms ?? 0} providers</Badge>
            <Badge variant="outline">{data?.models.enabled ?? 0} models</Badge>
            <Button size="sm" variant="ghost" className="ms-auto h-8" onClick={() => probeAll.mutate()} disabled={probeAll.isPending}>
              {probeAll.isPending
                ? <Loader2 className="me-1.5 size-3.5 animate-spin" aria-hidden />
                : <RefreshCw className="me-1.5 size-3.5" aria-hidden />}
              Re-check every key
            </Button>
          </div>
        </Section>

        <Section
          title={
            <span className="flex items-center gap-2">
              <Database className="size-4" aria-hidden /> Saved state
            </span>
          }
        >
          {p?.configured ? (
            <dl className="space-y-1.5 text-[12px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Snapshot store</dt>
                <dd className="truncate font-mono text-[11px]">{p.bucket}/{p.object}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Last upload</dt>
                <dd>{p.lastUploadAt ? new Date(p.lastUploadAt).toLocaleString() : 'never'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Pending write</dt>
                <dd>{p.pendingWrite ? 'yes — will retry' : 'no'}</dd>
              </div>
              {p.lastError && (
                <div className="flex justify-between gap-3 text-amber-600 dark:text-amber-400">
                  <dt>Last error</dt>
                  <dd className="max-w-[60%] truncate" title={p.lastError}>{p.lastError}</dd>
                </div>
              )}
              {p.staleSince && (
                <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    Another instance saved a newer copy at {new Date(p.staleSince).toLocaleString()}. This one is
                    serving older data and has stopped overwriting it — a cold start (redeploy) resyncs it.
                  </span>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              This deployment keeps its database on the local disk (self-hosted mode), so every change is already
              permanent. On a serverless host, configure the Supabase snapshot env vars and this panel will report
              each upload.
            </p>
          )}
        </Section>
      </div>
    </div>
  )
}

// ── Providers & keys ──────────────────────────────────────────────────────

function ProvidersTab() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [label, setLabel] = useState('')

  const providers = useQuery<{ providers: ProviderOption[] }>({
    queryKey: ['admin-providers'],
    queryFn: () => apiFetch('/api/admin/providers'),
  })
  const pool = useQuery<{ keys: PoolKey[] }>({
    queryKey: ['admin-keys'],
    queryFn: () => apiFetch('/api/admin/keys'),
  })

  const byPlatform = useMemo(
    () => new Map((providers.data?.providers ?? []).map(p => [p.platform, p])),
    [providers.data],
  )
  const selected = byPlatform.get(platform)

  function invalidate() {
    for (const key of ['admin-keys', 'admin-providers', 'admin-overview', 'keys', 'health']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
  }

  const addKey = useMutation({
    mutationFn: () =>
      apiFetch<{ key: PoolKey; modelsAvailable: number }>('/api/admin/keys', {
        method: 'POST',
        body: JSON.stringify({ platform, key: apiKey, label }),
      }),
    onSuccess: res => {
      toast.success(
        res.key.status === 'healthy'
          ? `${res.key.platform} verified — ${res.modelsAvailable} model${res.modelsAvailable === 1 ? '' : 's'} live for every account`
          : `${res.key.platform} added — reachable models: ${res.modelsAvailable}. It will be probed again shortly.`,
      )
      setApiKey('')
      setLabel('')
      invalidate()
    },
  })

  const patchKey = useMutation({
    mutationFn: (input: { id: number; enabled?: boolean }) =>
      apiFetch(`/api/admin/keys/${input.id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  })

  const probeKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/keys/${id}/check`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Probe finished')
      invalidate()
    },
  })

  const removeKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Key removed from every account')
      invalidate()
    },
  })

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Section
        title="Add a provider key"
        hint="Goes straight into the shared pool — every account can call these models as soon as this returns."
      >
        <form
          className="space-y-3"
          onSubmit={e => {
            e.preventDefault()
            if (!platform) {
              toast.error('Choose a provider first')
              return
            }
            addKey.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="admin-provider">Provider</Label>
            <Select value={platform} onValueChange={v => setPlatform(v ?? '')}>
              <SelectTrigger id="admin-provider" className="w-full">
                <SelectValue>{(v: string) => byPlatform.get(v)?.name ?? 'Choose a provider…'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(providers.data?.providers ?? []).map(p => (
                  <SelectItem key={p.platform} value={p.platform}>
                    <span className="flex w-full items-center justify-between gap-3">
                      <span>{p.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {p.keyCount > 0 ? `${p.keyCount} key${p.keyCount === 1 ? '' : 's'}` : p.kind === 'search' ? 'search' : ''}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="admin-key-input">API key</Label>
            <Input
              id="admin-key-input"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={selected?.keyless ? 'not needed for this provider' : 'paste the provider key'}
              disabled={selected?.keyless === true}
            />
            <p className="text-[11px] text-muted-foreground">Encrypted at rest, never shown again in full.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="admin-key-label">
              Label <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input id="admin-key-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. free tier" />
          </div>

          <Button type="submit" className="w-full" disabled={addKey.isPending || !platform}>
            {addKey.isPending && <Loader2 className="me-1.5 size-3.5 animate-spin" aria-hidden />}
            {addKey.isPending ? 'Verifying with the provider…' : 'Add to the shared pool'}
          </Button>
          {addKey.isError && (
            <p className="text-[11px] text-destructive">{(addKey.error as Error).message}</p>
          )}
        </form>
      </Section>

      <Section
        title="Shared pool"
        hint="Turning a key off stops every account from using that provider, without deleting the credential."
        action={<Badge variant="outline">{pool.data?.keys.length ?? 0}</Badge>}
      >
        {pool.isLoading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading…
          </p>
        )}
        {!pool.isLoading && (pool.data?.keys.length ?? 0) === 0 && (
          <p className="rounded-2xl border border-dashed p-6 text-center text-xs text-muted-foreground">
            No provider keys yet. Add one on the left and its models become available to every account.
          </p>
        )}

        <ul className="divide-y">
          {(pool.data?.keys ?? []).map(key => (
            <li key={key.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                  {byPlatform.get(key.platform)?.name ?? key.platform}
                  <StatusBadge status={key.status} enabled={key.enabled} />
                  {key.lastError && (
                    <span className="max-w-[22rem] truncate text-[11px] font-normal text-destructive" title={key.lastError}>
                      {key.lastError}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-mono">{key.maskedKey}</span>
                  {key.label ? ` · ${key.label}` : ''}
                  {key.lastCheckedAt ? ` · checked ${key.lastCheckedAt}` : ''}
                </p>
                {!key.enabled && key.status === 'invalid' && (
                  <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                    Turned off automatically after repeated failed probes — the provider rejects this credential.
                    Fix the key and switch it back on, or re-check to revive it.
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground"
                onClick={() => probeKey.mutate(key.id)}
                disabled={probeKey.isPending}
                aria-label={`Re-check ${key.platform} key`}
                title="Re-check now"
              >
                <RefreshCw className="size-3.5" aria-hidden />
              </Button>
              <Toggle
                checked={key.enabled}
                onChange={enabled => patchKey.mutate({ id: key.id, enabled })}
                label={`Enable ${key.platform}`}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-destructive"
                onClick={() => removeKey.mutate(key.id)}
                aria-label={`Remove ${key.platform} key`}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

// ── Accounts ──────────────────────────────────────────────────────────────

function AccountsTab() {
  const queryClient = useQueryClient()
  const users = useQuery<{ users: UserRow[] }>({
    queryKey: ['admin-users'],
    queryFn: () => apiFetch('/api/admin/users'),
  })

  const update = useMutation({
    mutationFn: (input: { id: number } & Partial<Pick<UserRow, 'role' | 'status' | 'apiAccess' | 'dailyLimit'>>) =>
      apiFetch(`/api/admin/users/${input.id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    },
  })

  const rotate = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ apiKey: string }>(`/api/admin/users/${id}/rotate-key`, { method: 'POST' }),
    onSuccess: res => {
      // Shown once, because the point of rotating is to hand the new value over.
      window.prompt('New API key for this account — copy it now, it will not be shown again:', res.apiKey)
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })

  const rows = users.data?.users ?? []

  return (
    <Section
      title="Accounts"
      hint="Everyone on this deployment. API access is the shared provider pool; suspension also blocks the dashboard."
      action={<Badge variant="outline">{rows.length}</Badge>}
    >
      <ul className="divide-y">
        {rows.map(user => (
          <li key={user.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                <span className="truncate">{user.email}</span>
                {user.role === 'admin' && (
                  <Badge className="h-5 gap-1"><ShieldCheck className="size-3" aria-hidden /> admin</Badge>
                )}
                {user.status === 'suspended' && (
                  <Badge variant="outline" className="h-5 border-destructive/40 text-destructive">suspended</Badge>
                )}
                {!user.apiAccess && (
                  <Badge variant="outline" className="h-5 border-amber-500/40 text-amber-600 dark:text-amber-400">no API access</Badge>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {user.requestsToday} request{user.requestsToday === 1 ? '' : 's'} today
                {user.dailyLimit !== null ? ` of ${user.dailyLimit}` : ' · no cap'}
                {` · joined ${user.createdAt}`}
              </p>
            </div>

            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              API
              <Toggle
                checked={user.apiAccess}
                onChange={apiAccess => update.mutate({ id: user.id, apiAccess })}
                label={`API access for ${user.email}`}
              />
            </label>

            <DailyLimitInput
              value={user.dailyLimit}
              onSave={dailyLimit => update.mutate({ id: user.id, dailyLimit })}
            />

            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}
            >
              {user.role === 'admin'
                ? <><UserMinus className="me-1 size-3.5" aria-hidden /> Make user</>
                : <><UserPlus className="me-1 size-3.5" aria-hidden /> Make admin</>}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              disabled={rotate.isPending}
              onClick={() => {
                if (!window.confirm(`Issue ${user.email} a new API key? Their current key stops working immediately.`)) return
                rotate.mutate(user.id)
              }}
              title="Replace this account's API key"
            >
              New key
            </Button>

            <Button
              variant={user.status === 'suspended' ? 'outline' : 'ghost'}
              size="sm"
              className="h-8"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: user.id, status: user.status === 'suspended' ? 'active' : 'suspended' })}
            >
              {user.status === 'suspended' ? 'Reactivate' : 'Suspend'}
            </Button>
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="rounded-2xl border border-dashed p-6 text-center text-xs text-muted-foreground">No accounts yet.</p>
      )}
    </Section>
  )
}

/** A per-account daily cap, edited in place: blank means unlimited. */
function DailyLimitInput({ value, onSave }: { value: number | null; onSave: (value: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  // Keep the field in sync when the list refreshes under the editor.
  const shown = value === null ? '' : String(value)
  const [lastShown, setLastShown] = useState(shown)
  if (shown !== lastShown) {
    setLastShown(shown)
    setDraft(shown)
  }

  function commit() {
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (value !== null) onSave(null)
      return
    }
    const parsed = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(shown)
      return
    }
    if (parsed !== value) onSave(parsed)
  }

  return (
    <Input
      className="h-8 w-24 text-[12px]"
      inputMode="numeric"
      placeholder="no cap"
      aria-label="Daily request limit"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
    />
  )
}

// ── Announcements ─────────────────────────────────────────────────────────

function AnnouncementsTab() {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [level, setLevel] = useState<'info' | 'success' | 'warning'>('info')

  const list = useQuery<{ announcements: Announcement[] }>({
    queryKey: ['admin-announcements'],
    queryFn: () => apiFetch('/api/admin/announcements'),
  })

  function invalidate() {
    for (const key of ['admin-announcements', 'announcements', 'admin-overview']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
  }

  const create = useMutation({
    mutationFn: () => apiFetch('/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({ title, body, level }),
    }),
    onSuccess: () => {
      toast.success('Announcement is live for everyone')
      setTitle('')
      setBody('')
      invalidate()
    },
  })

  const toggle = useMutation({
    mutationFn: (input: { id: number; active: boolean }) =>
      apiFetch(`/api/admin/announcements/${input.id}`, { method: 'PATCH', body: JSON.stringify({ active: input.active }) }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Section
        title="Post an announcement"
        hint="A banner on the dashboard and on the home page. Only the newest three are shown."
      >
        <form
          className="space-y-3"
          onSubmit={e => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ann-title">Title</Label>
            <Input id="ann-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Scheduled maintenance" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ann-body">Message</Label>
            <Textarea
              id="ann-body"
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={3}
              placeholder="Groq is rate-limited until 18:00 UTC; the router will prefer other providers."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="ann-level">Tone</Label>
            <Select value={level} onValueChange={v => setLevel((v ?? 'info') as typeof level)}>
              <SelectTrigger id="ann-level" className="w-full">
                <SelectValue>{(v: string) => v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">info</SelectItem>
                <SelectItem value="success">success</SelectItem>
                <SelectItem value="warning">warning</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="w-full" disabled={create.isPending || !title.trim() || !body.trim()}>
            {create.isPending && <Loader2 className="me-1.5 size-3.5 animate-spin" aria-hidden />}
            Publish
          </Button>
        </form>
      </Section>

      <Section title="Published" action={<Badge variant="outline">{list.data?.announcements.length ?? 0}</Badge>}>
        <ul className="divide-y">
          {(list.data?.announcements ?? []).map(item => (
            <li key={item.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                    {item.title}
                    <Badge variant="outline" className="h-5">{item.level}</Badge>
                    {!item.active && <span className="text-[11px] text-muted-foreground">hidden</span>}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => toggle.mutate({ id: item.id, active: !item.active })}
                  aria-label={item.active ? 'Hide announcement' : 'Show announcement'}
                >
                  {item.active ? <X className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate(item.id)}
                  aria-label="Delete announcement"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {(list.data?.announcements.length ?? 0) === 0 && (
          <p className="rounded-2xl border border-dashed p-6 text-center text-xs text-muted-foreground">
            Nothing published yet.
          </p>
        )}
      </Section>
    </div>
  )
}

// ── Access & settings ─────────────────────────────────────────────────────

function SettingsTab() {
  const queryClient = useQueryClient()
  const settings = useQuery<{ signupOpen: boolean; defaultApiAccess: boolean; defaultDailyLimit: number | null }>({
    queryKey: ['admin-access-settings'],
    queryFn: () => apiFetch('/api/admin/settings/access'),
  })
  const path = useQuery<{ path: string }>({
    queryKey: ['admin-path'],
    queryFn: () => apiFetch<{ path: string }>('/api/admin/path'),
  })

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/api/admin/settings/access', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-access-settings'] })
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
      queryClient.invalidateQueries({ queryKey: ['auth-status'] })
    },
  })

  const data = settings.data
  const defaultLimit = data?.defaultDailyLimit

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Sign-ups" hint="Whether a new person can create an account on this deployment.">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Open: anyone with this URL can create their own account and key. Closed: only existing accounts can sign in.
          </p>
          <Toggle
            checked={data?.signupOpen ?? false}
            onChange={signupOpen => patch.mutate({ signupOpen })}
            label="Allow sign-ups"
          />
        </div>
      </Section>

      <Section title="New accounts" hint="What a brand-new account starts with. Existing accounts keep their own settings.">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[12px] text-muted-foreground">API access to the shared provider pool</p>
            <Toggle
              checked={data?.defaultApiAccess ?? false}
              onChange={defaultApiAccess => patch.mutate({ defaultApiAccess })}
              label="API access for new accounts"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-[12px] text-muted-foreground">Daily request cap (blank = unlimited)</p>
            <DailyLimitInput
              value={defaultLimit ?? null}
              onSave={defaultDailyLimit => patch.mutate({ defaultDailyLimit })}
            />
          </div>
        </div>
      </Section>

      <Section title="Admin console URL" hint="Where this panel lives. Not linked anywhere — bookmark it.">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border bg-muted/40 px-2.5 py-1.5 font-mono text-[12px]">
            {path.data?.path ?? '…'}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const value = path.data?.path
              if (!value) return
              const url = `${window.location.origin}${value}`
              if (await copyText(url)) toast.success('Admin URL copied')
              else toast.error('Could not copy — select it manually')
            }}
          >
            <Copy className="me-1 size-3.5" aria-hidden /> Copy
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Change it with <code className="font-mono">FLUZY_ADMIN_PATH</code>. Only an admin session can open it;
          everyone else gets the ordinary not-found page.
        </p>
      </Section>

      <Section title="How access works" hint="The short version, for whoever runs this next.">
        <ul className="space-y-2 text-[12px] leading-relaxed text-muted-foreground">
          <li className="flex gap-2"><KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Provider keys are one shared pool. Adding one here makes its models available to every account instantly.</li>
          <li className="flex gap-2"><Gauge className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Each account has its own <code className="font-mono">/v1</code> key, its own daily cap, and an API on/off switch.</li>
          <li className="flex gap-2"><Activity className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Suspending an account blocks both the API and the dashboard, and keeps its data.</li>
          <li className="flex gap-2"><Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Only admins see this console. The last admin can never be demoted or suspended.</li>
          <li className="flex gap-2"><Megaphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Announcements are public: they show on the home page before anyone signs in.</li>
        </ul>
      </Section>
    </div>
  )
}
