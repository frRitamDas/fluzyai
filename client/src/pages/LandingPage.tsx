import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  Database,
  GitBranch,
  KeyRound,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Terminal,
  Waypoints,
} from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { AnnouncementBanner } from '@/components/announcement-banner'

/**
 * The public home page: what Fluzy AI is, for someone who has not signed in yet.
 *
 * It sits outside the dashboard shell (no navbar, no queries), so it renders
 * from static markup with no authenticated request behind it — the first paint
 * never waits on the API. `needsSetup` only changes the wording of the primary
 * call to action: a fresh deployment has no account to sign in with yet, so
 * "Create account" is the honest label there, while a claimed one sends people
 * to the sign-in form.
 *
 * Copy is English-only on purpose. It is a marketing surface rather than app
 * chrome, it changes far more often than the dashboard's strings, and shipping
 * sixty translations of a sentence that is rewritten weekly would leave every
 * locale permanently stale.
 */

const FEATURES = [
  {
    icon: Waypoints,
    title: 'One endpoint, every provider',
    body: 'Groq, Gemini, Cerebras, Mistral, OpenRouter, NVIDIA, Ollama and dozens more behind a single OpenAI-compatible /v1 surface.',
  },
  {
    icon: GitBranch,
    title: 'Automatic failover',
    body: 'When a model is rate-limited, out of quota or down, the router moves the request to the next healthy provider — mid-stream, without the client noticing.',
  },
  {
    icon: BarChart3,
    title: 'Quotas you can see',
    body: 'Per-provider request and token budgets, cooldowns and headroom, so free tiers get used before they get exhausted.',
  },
  {
    icon: Boxes,
    title: 'Every modality',
    body: 'Chat, embeddings, images, video, audio, transcription, search and agent runs — plus Anthropic, Gemini and MCP compatibility surfaces.',
  },
  {
    icon: Database,
    title: 'Your data stays yours',
    body: 'One SQLite file you own, with encrypted provider keys at rest. Self-host it, run it in Docker, or deploy it serverless on Vercel with a Supabase snapshot.',
  },
  {
    icon: ShieldCheck,
    title: 'A key per account',
    body: 'Every account gets its own /v1 key. Rotate yours and only your clients change — nobody else on the deployment notices.',
  },
]

const STEPS = [
  {
    title: 'Create your account',
    body: 'One account per person, with its own API key. Provider keys are shared and managed by the deployment admin, so every model is available to you on day one.',
  },
  {
    title: 'Call every model',
    body: 'The admin adds the free-tier provider keys once — Fluzy AI verifies each and learns the models it serves — and they are live for every account. Hosting it yourself? You are the admin.',
  },
  {
    title: 'Point your client at /v1',
    body: 'Use your key from the dashboard anywhere an OpenAI base URL is accepted.',
  },
]

const PROVIDERS = [
  'Groq', 'Google Gemini', 'Cerebras', 'Mistral', 'OpenRouter', 'NVIDIA NIM',
  'Together', 'Hyperbolic', 'SambaNova', 'Fireworks', 'Ollama', 'LM Studio',
]

const CURL = `curl https://fluzyaiorg.vercel.app/v1/chat/completions \\
  -H "Authorization: Bearer $FLUZY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{ "role": "user", "content": "Hello!" }]
  }'`

export function LandingPage({ needsSetup }: { needsSetup: boolean }) {
  const primaryTo = needsSetup ? '/signup' : '/login'
  const primaryLabel = needsSetup ? 'Create account' : 'Sign in'
  const secondaryTo = needsSetup ? '/login' : '/signup'
  const secondaryLabel = needsSetup ? 'Sign in' : 'Create account'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="inline-block size-2.5 rounded-full bg-foreground" />
            <span className="text-sm font-semibold tracking-tight">Fluzy AI</span>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">by Ritam Das</span>
          </Link>
          <nav className="flex items-center gap-1.5">
            <a
              href="#how-it-works"
              className="hidden rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              How it works
            </a>
            <Link to={secondaryTo} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-9 px-3')}>
              {secondaryLabel}
            </Link>
            <Link to={primaryTo} className={cn(buttonVariants({ size: 'sm' }), 'h-9 px-3.5')}>
              {primaryLabel}
              <ArrowRight className="ms-1 size-3.5" aria-hidden />
            </Link>
          </nav>
        </div>
      </header>

      {/* Operator notices (maintenance, a provider outage) reach visitors before
          they create an account, not only after they sign in. */}
      <AnnouncementBanner />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          {/* A faint wash of the foreground colour behind the headline. It has
              to be the foreground and not the accent: accent is near-white in
              the light theme, so the glow would be invisible there. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-48 h-[30rem] bg-[radial-gradient(ellipse_at_top,var(--color-foreground),transparent_65%)] opacity-[0.07] dark:opacity-[0.12]"
          />
          <div className="relative mx-auto w-full max-w-6xl px-5 pt-16 pb-14 sm:pt-24">
            <div className="mx-auto max-w-3xl text-center">
              <Badge variant="outline" className="mb-5 h-6 gap-1.5 px-2.5 text-[11px]">
                <Sparkles className="size-3" aria-hidden />
                OpenAI-compatible · self-hosted · free tiers first
              </Badge>
              <h1 className="font-heading text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-6xl">
                One API key.
                <br className="hidden sm:block" /> Every LLM you can use for free.
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty sm:text-base">
                Fluzy AI is a local-first gateway for the free tiers of dozens of model providers. Keep your keys in one
                place, call a single <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">/v1</code>{' '}
                endpoint, and let the router find a provider that still has quota left.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
                <Link to={primaryTo} className={cn(buttonVariants({ size: 'lg' }), 'h-11 w-full px-6 sm:w-auto')}>
                  {needsSetup ? 'Create your account' : 'Sign in to the dashboard'}
                  <ArrowRight className="ms-1.5 size-4" aria-hidden />
                </Link>
                <Link
                  to={secondaryTo}
                  className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11 w-full px-6 sm:w-auto')}
                >
                  {needsSetup ? 'I already have an account' : 'Create an account'}
                </Link>
              </div>
              <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Check className="size-3.5" aria-hidden />
                No credit card. No telemetry. The database is a file on your machine.
              </p>
            </div>

            {/* Provider strip */}
            <div className="mt-14">
              <p className="text-center text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Speaks to
              </p>
              <ul className="mx-auto mt-4 flex max-w-4xl flex-wrap items-center justify-center gap-x-2 gap-y-2">
                {PROVIDERS.map(name => (
                  <li
                    key={name}
                    className="rounded-full border border-border/70 bg-card/60 px-3 py-1 text-xs text-muted-foreground"
                  >
                    {name}
                  </li>
                ))}
                <li className="rounded-full border border-dashed border-border/70 px-3 py-1 text-xs text-muted-foreground">
                  + many more
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto w-full max-w-6xl px-5 py-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-3xl border bg-card p-5">
                <div className="mb-3 inline-flex size-9 items-center justify-center rounded-2xl bg-muted">
                  <Icon className="size-4.5" aria-hidden />
                </div>
                <h3 className="font-heading text-sm font-medium">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-14">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
                Three steps to a working endpoint
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                The dashboard walks you through it the first time you sign in. Everything below is editable later —
                routing order, fallback chains, budgets, cooldowns.
              </p>
              <ol className="mt-7 space-y-5">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-3.5">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-medium">{step.title}</h3>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-3xl border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <Terminal className="size-4" aria-hidden />
                <span className="text-xs font-medium">Any OpenAI client works</span>
              </div>
              <pre className="overflow-x-auto rounded-2xl bg-muted/60 p-4 text-[11.5px] leading-relaxed">
                <code>{CURL}</code>
              </pre>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="flex items-start gap-2 rounded-2xl border border-border/60 p-3">
                  <KeyRound className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Send <code className="font-mono">model: "auto"</code> and let the router choose, or name a model
                    explicitly.
                  </p>
                </div>
                <div className="flex items-start gap-2 rounded-2xl border border-border/60 p-3">
                  <PlayCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Try it in the built-in Playground before wiring an app to it.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto w-full max-w-6xl px-5 pb-20">
          <div className="rounded-3xl border bg-card px-6 py-10 text-center">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {needsSetup ? 'Set up your dashboard' : 'Welcome back'}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              {needsSetup
                ? 'Create the account that will own this deployment. It takes one email and a password.'
                : 'Sign in to manage keys, routing, quotas and analytics.'}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
              <Link to={primaryTo} className={cn(buttonVariants({ size: 'lg' }), 'h-11 w-full px-6 sm:w-auto')}>
                {needsSetup ? 'Create your account' : 'Sign in'}
                <ArrowRight className="ms-1.5 size-4" aria-hidden />
              </Link>
              <Link
                to={secondaryTo}
                className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'h-11 w-full px-6 sm:w-auto')}
              >
                {secondaryLabel}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-5 py-6 text-xs text-muted-foreground sm:flex-row">
          <p>
            © {new Date().getFullYear()} Fluzy AI · Developed by <span className="text-foreground">Ritam Das</span>
          </p>
          <nav className="flex items-center gap-4">
            <a
              href="https://github.com/frRitamDas/fluzyai"
              className="transition-colors hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              Source
            </a>
            <a href="/livez" className="transition-colors hover:text-foreground">
              Status
            </a>
            <Link to={secondaryTo} className="transition-colors hover:text-foreground">
              {secondaryLabel}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
