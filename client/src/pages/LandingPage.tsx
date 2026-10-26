import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  Check,
  GitBranch,
  KeyRound,
  PlayCircle,
  Sparkles,
  Terminal,
  Waypoints,
} from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { AnnouncementBanner } from '@/components/announcement-banner'

/**
 * The public home page.
 *
 * Three jobs, in order: say what Fluzy AI is in one line, show the one code
 * block that proves it, and offer Sign in / Create account at every scroll
 * depth. Everything else is deliberately short — a landing page that needs to be
 * read is a landing page nobody reads.
 *
 * It renders outside the dashboard shell with no authenticated request behind
 * the first paint, so the page cannot be blocked by an API that is warming up.
 * `needsSetup` only changes the primary call to action's wording: a fresh
 * deployment has no account to sign in with yet.
 *
 * Copy is English-only on purpose — a marketing surface changes far more often
 * than the dashboard's strings.
 */

const VALUE_PROPS = [
  {
    icon: Waypoints,
    title: 'One endpoint',
    body: 'Groq, Gemini, Cerebras, Mistral, OpenRouter, NVIDIA, Ollama and dozens more behind one OpenAI-compatible /v1.',
  },
  {
    icon: GitBranch,
    title: 'Automatic failover',
    body: 'Rate-limited, out of quota, or down? The request moves to the next healthy provider mid-stream.',
  },
  {
    icon: Boxes,
    title: 'Every modality',
    body: 'Chat, embeddings, images, video, audio, search and agent runs — plus Anthropic, Gemini and MCP surfaces.',
  },
]

const STEPS = [
  { title: 'Create your account', body: 'One account, one API key of your own.' },
  { title: 'Use every model', body: 'The provider pool is shared, so the models are ready when you are.' },
  { title: 'Point your client at /v1', body: 'Any OpenAI base URL works. Send model "auto" and let the router choose.' },
]

const PROVIDERS = [
  'Groq', 'Gemini', 'Cerebras', 'Mistral', 'OpenRouter', 'NVIDIA NIM',
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
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="inline-block size-2.5 rounded-full bg-foreground" />
            <span className="text-sm font-semibold tracking-tight">Fluzy AI</span>
          </Link>

          <nav className="ms-4 hidden items-center gap-5 text-[13px] text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#providers" className="transition-colors hover:text-foreground">Providers</a>
            <a href="#how-it-works" className="transition-colors hover:text-foreground">How it works</a>
            <a
              href="https://github.com/frRitamDas/fluzyai"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Source
            </a>
          </nav>

          <div className="ms-auto flex items-center gap-1.5">
            <Link to={secondaryTo} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-9 px-3')}>
              {secondaryLabel}
            </Link>
            <Link to={primaryTo} className={cn(buttonVariants({ size: 'sm' }), 'h-9 px-3.5')}>
              {primaryLabel}
            </Link>
          </div>
        </div>
      </header>

      {/* Operator notices reach visitors before they create an account. */}
      <AnnouncementBanner />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-56 h-[32rem] bg-[radial-gradient(ellipse_at_top,var(--color-foreground),transparent_65%)] opacity-[0.06] dark:opacity-[0.12]"
          />
          <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-5 pt-14 pb-12 lg:grid-cols-[1.05fr_minmax(0,1fr)] lg:items-center lg:gap-14 lg:pt-20">
            <div>
              <Badge variant="outline" className="mb-5 h-6 gap-1.5 px-2.5 text-[11px]">
                <Sparkles className="size-3" aria-hidden />
                Free tiers first · OpenAI-compatible
              </Badge>
              <h1 className="font-heading text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem]">
                One API key.
                <br />
                Every model you can use for free.
              </h1>
              <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted-foreground text-pretty">
                Fluzy AI puts the free tiers of dozens of providers behind a single{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">/v1</code> endpoint, and moves
                each request to a provider that still has quota.
              </p>

              <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
                <Link to={primaryTo} className={cn(buttonVariants({ size: 'lg' }), 'h-11 w-full px-6 sm:w-auto')}>
                  {needsSetup ? 'Create your account' : 'Sign in'}
                  <ArrowRight className="ms-1.5 size-4" aria-hidden />
                </Link>
                <Link
                  to={secondaryTo}
                  className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11 w-full px-6 sm:w-auto')}
                >
                  {needsSetup ? 'Sign in' : 'Create an account'}
                </Link>
              </div>

              <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
                {['No credit card', 'No telemetry', 'Your keys, encrypted at rest'].map(item => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check className="size-3.5" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* The proof: one request, no provider SDK, no config. */}
            <div className="rounded-3xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-2 px-1 pb-3">
                <Terminal className="size-4 text-muted-foreground" aria-hidden />
                <span className="text-xs font-medium">Any OpenAI client works</span>
                <span className="ms-auto rounded-full border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  POST /v1/chat/completions
                </span>
              </div>
              <pre className="overflow-x-auto rounded-2xl bg-muted/60 p-4 text-[11.5px] leading-relaxed">
                <code>{CURL}</code>
              </pre>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="flex items-start gap-2 rounded-2xl border border-border/60 p-3">
                  <KeyRound className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Your own key, revocable on its own.
                  </p>
                </div>
                <div className="flex items-start gap-2 rounded-2xl border border-border/60 p-3">
                  <PlayCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Or try it in the built-in Playground first.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Value props ──────────────────────────────────────────────── */}
        <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 pb-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {VALUE_PROPS.map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-3xl border bg-card p-5">
                <div className="mb-3 inline-flex size-9 items-center justify-center rounded-2xl bg-muted">
                  <Icon className="size-4.5" aria-hidden />
                </div>
                <h2 className="font-heading text-sm font-medium">{title}</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Providers ────────────────────────────────────────────────── */}
        <section id="providers" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-lg font-semibold tracking-tight">Speaks to the free tiers</h2>
            <p className="text-[12px] text-muted-foreground">Add a key once — every account can call it.</p>
          </div>
          <ul className="mt-4 flex flex-wrap gap-1.5">
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
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section id="how-it-works" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 pb-14">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Three steps</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-3xl border bg-card p-5">
                <span className="flex size-6 items-center justify-center rounded-full border text-[11px] font-medium">
                  {index + 1}
                </span>
                <h3 className="mt-3 text-sm font-medium">{step.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Closing call to action ───────────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-5 pb-20">
          <div className="flex flex-col items-center gap-4 rounded-3xl border bg-card px-6 py-10 text-center">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {needsSetup ? 'Set up your dashboard' : 'Ready when you are'}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {needsSetup
                ? 'Create the account that will own this deployment — one email and a password.'
                : 'Sign in to call every model with your own key, or create an account in a few seconds.'}
            </p>
            <div className="flex flex-col gap-2.5 sm:flex-row">
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
