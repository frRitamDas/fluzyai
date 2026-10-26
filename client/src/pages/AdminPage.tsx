import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  KeyRound,
  Loader2,
  Megaphone,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react'

import { apiFetch } from '@/lib/api'
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
 * The admin panel.
 *
 * Everything here is deployment-wide: the provider keys the router draws on for
 * every account, who else may administer it, and the banner everyone sees.
 * A key added here is in the shared pool the moment the request returns — the
 * same table the router reads — which is what makes it available to every user
 * without a publish step.
 *
 * Reachable only by an admin session; the server enforces that on /api/admin, so
 * hiding the nav entry is presentation, not the control.
 */

type Tab = 'providers' | 'users' | 'announcements'

interface Overview {
  users: { total: number; admins: number }
  keys: { total: number; enabled: number; healthy: number; platforms: number }
  models: { total: number; enabled: number }
  requests: { total: number; today: number }
  announcements: { active: number }
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

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'healthy'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : status === 'invalid' || status === 'error'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-border text-muted-foreground'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {status}
    </span>
  )
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('providers')

  const overview = useQuery<Overview>({
    queryKey: ['admin-overview'],
    queryFn: () => apiFetch('/api/admin/overview'),
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading flex items-center gap-2 text-xl font-semibold tracking-tight">
            <ShieldCheck className="size-5" aria-hidden />
            Admin panel
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage the shared provider pool, the accounts on this deployment, and the global announcement.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Accounts" value={overview.data?.users.total ?? '—'} hint={`${overview.data?.users.admins ?? '—'} admin`} />
        <StatCard label="Provider keys" value={overview.data?.keys.total ?? '—'} hint={`${overview.data?.keys.enabled ?? '—'} enabled`} />
        <StatCard label="Healthy" value={overview.data?.keys.healthy ?? '—'} hint="last probe ok" />
        <StatCard label="Providers" value={overview.data?.keys.platforms ?? '—'} hint="configured" />
        <StatCard label="Models live" value={overview.data?.models.enabled ?? '—'} hint={`${overview.data?.models.total ?? '—'} in catalog`} />
        <StatCard label="Requests today" value={overview.data?.requests.today ?? '—'} hint={`${overview.data?.requests.total ?? '—'} all time`} />
      </div>

      <SegmentedControl<Tab>
        value={tab}
        onValueChange={setTab}
        ariaLabel="Admin sections"
        options={[
          { value: 'providers', label: 'Providers & keys' },
          { value: 'users', label: 'Accounts' },
          { value: 'announcements', label: 'Announcements' },
        ]}
      />

      {tab === 'providers' && <ProvidersTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'announcements' && <AnnouncementsTab />}
    </div>
  )
}

// ── Providers ─────────────────────────────────────────────────────────────

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
    queryClient.invalidateQueries({ queryKey: ['admin-keys'] })
    queryClient.invalidateQueries({ queryKey: ['admin-providers'] })
    queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
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
          ? `${res.key.platform} key verified — ${res.modelsAvailable} model${res.modelsAvailable === 1 ? '' : 's'} available to everyone`
          : `${res.key.platform} key added — it will be probed on the next health cycle`,
      )
      setApiKey('')
      setLabel('')
      invalidate()
    },
  })

  const toggleKey = useMutation({
    mutationFn: (input: { id: number; enabled: boolean }) =>
      apiFetch(`/api/admin/keys/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: input.enabled }),
      }),
    onSuccess: invalidate,
  })

  const removeKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Key removed from the shared pool')
      invalidate()
    },
  })

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <section className="h-fit rounded-3xl border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Plus className="size-4" aria-hidden />
          Add a provider key
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          Goes straight into the shared pool: every account can call these models as soon as this returns, no publish
          step.
        </p>

        <form
          className="mt-4 space-y-3"
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
                <SelectValue>
                  {(v: string) => byPlatform.get(v)?.name ?? 'Choose a provider…'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(providers.data?.providers ?? []).map(p => (
                  <SelectItem key={p.platform} value={p.platform}>
                    <span className="flex w-full items-center justify-between gap-3">
                      <span>{p.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {p.kind === 'search' ? 'search' : p.keyCount > 0 ? `${p.keyCount} key` : ''}
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
            <p className="text-[11px] text-muted-foreground">
              Stored encrypted. Never shown again in full.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="admin-key-label">Label <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="admin-key-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. personal free tier"
            />
          </div>

          <Button type="submit" className="w-full" disabled={addKey.isPending || !platform}>
            {addKey.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" aria-hidden /> : null}
            {addKey.isPending ? 'Verifying with the provider…' : 'Add to the shared pool'}
          </Button>
        </form>
      </section>

      <section className="rounded-3xl border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="size-4" aria-hidden />
            Shared pool
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {pool.data?.keys.length ?? 0} key{(pool.data?.keys.length ?? 0) === 1 ? '' : 's'}
          </span>
        </div>

        {pool.isLoading && (
          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading…
          </p>
        )}
        {!pool.isLoading && (pool.data?.keys.length ?? 0) === 0 && (
          <p className="mt-4 rounded-2xl border border-dashed p-6 text-center text-xs text-muted-foreground">
            No provider keys yet. Add one on the left and its models become available to every account.
          </p>
        )}

        <ul className="mt-3 divide-y">
          {(pool.data?.keys ?? []).map(key => (
            <li key={key.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px] font-medium">
                  {byPlatform.get(key.platform)?.name ?? key.platform}
                  <StatusBadge status={key.status} />
                  {key.lastError && (
                    <span className="truncate text-[11px] font-normal text-destructive" title={key.lastError}>
                      {key.lastError}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {key.maskedKey}
                  {key.label ? ` · ${key.label}` : ''}
                </p>
              </div>
              <Switch
                checked={key.enabled}
                onCheckedChange={enabled => toggleKey.mutate({ id: key.id, enabled })}
                aria-label={`Enable ${key.platform}`}
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
      </section>
    </div>
  )
}

// ── Accounts ──────────────────────────────────────────────────────────────

function UsersTab() {
  const queryClient = useQueryClient()
  const users = useQuery<{ users: UserRow[] }>({
    queryKey: ['admin-users'],
    queryFn: () => apiFetch('/api/admin/users'),
  })

  const setRole = useMutation({
    mutationFn: (input: { id: number; role: 'admin' | 'user' }) =>
      apiFetch(`/api/admin/users/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: input.role }),
      }),
    onSuccess: () => {
      toast.success('Account updated')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    },
  })

  return (
    <section className="rounded-3xl border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Users className="size-4" aria-hidden />
        Accounts on this deployment
      </h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Admins manage the shared pool and can add other admins. Everyone can use every model with their own API key.
      </p>

      <ul className="mt-4 divide-y">
        {(users.data?.users ?? []).map(user => (
          <li key={user.id} className="flex flex-wrap items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{user.email}</p>
              <p className="text-[11px] text-muted-foreground">
                joined {user.createdAt} · {user.hasApiKey ? 'has an API key' : 'no key yet'}
              </p>
            </div>
            <Badge variant={user.role === 'admin' ? 'default' : 'outline'} className="h-5">
              {user.role}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={setRole.isPending}
              onClick={() => setRole.mutate({ id: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}
            >
              {user.role === 'admin' ? 'Make user' : 'Make admin'}
            </Button>
          </li>
        ))}
      </ul>
      {(users.data?.users.length ?? 0) === 0 && (
        <p className="mt-4 rounded-2xl border border-dashed p-6 text-center text-xs text-muted-foreground">
          No accounts yet.
        </p>
      )}
    </section>
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
    queryClient.invalidateQueries({ queryKey: ['admin-announcements'] })
    queryClient.invalidateQueries({ queryKey: ['announcements'] })
    queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
  }

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/announcements', {
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
      apiFetch(`/api/admin/announcements/${input.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: input.active }),
      }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <section className="h-fit rounded-3xl border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Megaphone className="size-4" aria-hidden />
          Post an announcement
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          Shown as a banner on the dashboard and on the home page. Only the newest three are displayed.
        </p>
        <form
          className="mt-4 space-y-3"
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
            <Textarea id="ann-body" value={body} onChange={e => setBody(e.target.value)} rows={3} placeholder="Groq is rate-limited until 18:00 UTC; the router will prefer other providers." />
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
            {create.isPending ? <Loader2 className="me-1.5 size-3.5 animate-spin" aria-hidden /> : null}
            Publish
          </Button>
        </form>
      </section>

      <section className="rounded-3xl border bg-card p-5">
        <h2 className="text-sm font-medium">Published</h2>
        <ul className="mt-3 divide-y">
          {(list.data?.announcements ?? []).map(item => (
            <li key={item.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13px] font-medium">
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
          <p className="mt-4 rounded-2xl border border-dashed p-6 text-center text-xs text-muted-foreground">
            Nothing published yet.
          </p>
        )}
      </section>
    </div>
  )
}
