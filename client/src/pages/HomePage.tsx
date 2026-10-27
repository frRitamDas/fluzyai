import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Boxes,
  CircleAlert,
  Gauge,
  KeyRound,
  Layers,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react'

import { CopyButton } from '@/components/copy-button'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useHome } from '@/hooks/use-home'
import { useAdminPath, useAdminStatus } from '@/lib/use-admin'
import { cn } from '@/lib/utils'

/**
 * The screen a signed-in person lands on.
 *
 * It answers the four questions someone actually has when they open this: what
 * is my key, what do I send requests to, is anything working right now, and
 * where do I go next. Everything is one request (`/api/home`), so the page has a
 * single loading state and a single retry.
 *
 * Layout is mobile-first: a single column under `md`, then a two-column split
 * where the endpoint card takes the wider side. Every value here is variable
 * width (an email, a 56-character key, counts), so the cards use `min-w-0`,
 * `truncate` and `break-all` rather than hoping nothing is ever long.
 */

function mask(key: string): string {
  if (key.length <= 12) return key
  return `${key.slice(0, 11)}${'•'.repeat(12)}${key.slice(-4)}`
}

function baseUrl(): string {
  if (typeof window === 'undefined') return '/v1'
  return `${window.location.origin}/v1`
}

/** A number with its limit, e.g. "12 / 100" or "12 · unlimited". */
function usageLabel(used: number, limit: number | null): string {
  return limit === null ? `${used} · unlimited` : `${used} / ${limit}`
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: typeof Activity
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'warn'
}) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className={cn('size-3.5 shrink-0', tone === 'warn' && 'text-amber-600 dark:text-amber-400')} aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1.5 truncate text-lg leading-none font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export default function HomePage() {
  const { data, isLoading, isError, refetch } = useHome()
  const { isAdmin } = useAdminStatus()
  const adminPath = useAdminPath()

  const actions = useMemo(() => {
    const items = [
      { to: '/playground', icon: MessageSquare, title: 'Playground', body: 'Chat with any model, no code.' },
      { to: '/models/chat', icon: Layers, title: 'Models', body: 'Browse and rank what is available.' },
      { to: '/keys', icon: KeyRound, title: 'API keys', body: 'See providers and rotate your key.' },
      { to: '/analytics', icon: Activity, title: 'Analytics', body: 'Requests, latency and spend.' },
    ]
    if (isAdmin && adminPath) {
      items.push({ to: adminPath, icon: ShieldCheck, title: 'Admin console', body: 'Accounts, access and settings.' })
    }
    return items
  }, [isAdmin, adminPath])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-44 rounded-3xl" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border bg-card p-6 text-center">
        <CircleAlert className="mx-auto size-7 text-muted-foreground" aria-hidden />
        <h1 className="mt-3 text-base font-semibold">Could not load your dashboard</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          The summary request failed. It is usually a moment of restarts between deploys.
        </p>
        <Button className="mt-4" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const { account, key, models, providers, requests, announcements } = data
  const name = account.email.split('@')[0]
  const noProviders = providers.configured === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${name}`}
        description="One OpenAI-compatible endpoint for every model in this deployment."
        actions={
          <Badge variant={account.role === 'admin' ? 'default' : 'secondary'} className="h-6">
            {account.role === 'admin' ? 'Administrator' : 'Member'}
          </Badge>
        }
        divider={false}
      />

      {/* Notices first: an outage matters more than any count below it. */}
      {announcements.length > 0 && (
        <div className="space-y-2">
          {announcements.map(a => (
            <div
              key={a.id}
              role="status"
              className={cn(
                'flex items-start gap-2 rounded-2xl border p-3 text-[13px]',
                a.level === 'error'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : a.level === 'warning'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-muted/60',
              )}
            >
              <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium">{a.title}</p>
                <p className="mt-0.5 break-words opacity-90">{a.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {noProviders && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-[13px] text-amber-700 sm:flex-row sm:items-center dark:text-amber-300">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            No provider key is enabled yet, so requests will fail until an administrator adds one in the console.
          </p>
          <Link to="/keys" className="shrink-0 font-medium underline underline-offset-4">
            Review providers
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Gauge}
          label="Your requests today"
          value={usageLabel(account.requestsToday, account.dailyLimit)}
          hint={account.dailyLimit === null ? 'No daily cap on this account' : 'Resets at 00:00 UTC'}
        />
        <Stat icon={Boxes} label="Models available" value={String(models.enabled)} hint={`${models.platforms} providers`} />
        <Stat
          icon={ShieldCheck}
          label="Providers healthy"
          value={`${providers.healthy} / ${providers.configured}`}
          hint={providers.configured === 0 ? 'None configured' : `${providers.platforms} connected`}
          tone={providers.healthy === 0 ? 'warn' : 'default'}
        />
        <Stat icon={Activity} label="Requests served" value={String(requests.total)} hint={`${requests.today} today, all accounts`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* The two things every client needs, copied rather than retyped. */}
        <Card className="min-w-0 gap-0 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Terminal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-medium">Connect your client</h2>
            <span className="ms-auto hidden shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
              OpenAI-compatible
            </span>
          </div>

          <dl className="mt-4 space-y-3">
            <div className="min-w-0">
              <dt className="text-[11px] font-medium text-muted-foreground">Base URL</dt>
              <dd className="mt-1 flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-muted/70 px-2.5 py-1.5 font-mono text-[12px]">
                  {baseUrl()}
                </code>
                <CopyButton text={baseUrl()} className="size-8 shrink-0" label="Copy base URL" />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-medium text-muted-foreground">Your API key</dt>
              {/* A key is one long token: it must wrap, never widen the card. */}
              <dd className="mt-1 flex items-start gap-1.5">
                <code className="min-w-0 flex-1 overflow-hidden rounded-lg bg-muted/70 px-2.5 py-1.5 font-mono text-[12px] break-all">
                  {mask(key.apiKey)}
                </code>
                <CopyButton text={key.apiKey} className="size-8 shrink-0" label="Copy API key" />
              </dd>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Send it as <code className="font-mono">Authorization: Bearer …</code>. Rotate it from the keys page.
              </p>
            </div>
          </dl>

          <div className="mt-4 rounded-2xl bg-muted/50 p-3">
            <pre className="overflow-x-auto text-[11.5px] leading-relaxed">
              <code>{`curl ${baseUrl()}/chat/completions \\
  -H "Authorization: Bearer ${mask(key.apiKey)}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"Hi"}]}'`}</code>
            </pre>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link to="/playground" className={cn(buttonVariants({ size: 'sm' }), 'w-full sm:w-auto')}>
              Open the Playground
              <ArrowRight className="ms-1.5 size-3.5" aria-hidden />
            </Link>
            <Link to="/keys" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full sm:w-auto')}>
              Manage my key
            </Link>
          </div>
        </Card>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {actions.map(({ to, icon: Icon, title, body }) => (
            <Link
              key={to}
              to={to}
              className="group flex min-w-0 items-start gap-3 rounded-2xl border bg-card p-3.5 transition-colors hover:bg-muted/50"
            >
              <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{title}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{body}</span>
              </span>
              <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </Link>
          ))}
        </div>
      </div>

      {!account.apiAccess && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3.5 text-[13px] text-destructive">
          API access is turned off for this account, so /v1 requests with your key are rejected. An administrator can
          switch it back on in the console.
        </div>
      )}
    </div>
  )
}
