import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2 } from 'lucide-react'
import { LandingPage } from '@/pages/LandingPage'
import { apiFetch, setToken, UNAUTHORIZED_EVENT, type ApiError } from '@/lib/api'
import { Button, buttonVariants } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { isEmail } from '@/lib/validate'
import { useI18n } from '@/i18n'
import { toast } from '@/lib/toast'

// Matches the server rule (routes/auth.ts zod schema).
const PASSWORD_MIN = 8

// Inside the desktop shell the dashboard runs as a hidden machine account with
// a random password nobody knows (desktop/src/server-host.ts). There are no
// credentials to type, so the gate never shows a login form there: when the
// seeded session is gone (expired after a month of uptime, or cleared by a
// 401) it asks the shell for a fresh one through the preload bridge.
type DesktopWindow = Window & {
  __FLUZY_DESKTOP__?: boolean
  __FLUZY_SESSION__?: () => Promise<string>
}
function desktopSessionBridge(): (() => Promise<string>) | null {
  if (typeof window === 'undefined') return null
  const w = window as DesktopWindow
  return w.__FLUZY_DESKTOP__ === true && typeof w.__FLUZY_SESSION__ === 'function'
    ? w.__FLUZY_SESSION__
    : null
}

// The same dashboard opened in a normal browser tab on a desktop install has no
// preload bridge, so the server mints the session instead (#1399). It only
// does so for a request from this computer, and says so through `desktop` on
// /api/auth/status; web and Docker installs never set it and keep their login.
async function browserDesktopSession(): Promise<string> {
  const res = await apiFetch<{ token: string }>('/api/auth/desktop-session', { method: 'POST' })
  return res.token
}

interface AuthStatus {
  needsSetup: boolean
  // A remote browser would be stopped by the one-time setup code, so the form
  // asks for it alongside the credentials instead of after a rejected submit.
  setupCodeRequired?: boolean
  // Whether a new account can be created at all. Open by default (the deployment
  // is shared: one account per person, one admin-managed provider pool); the
  // server reports false only when the operator set FLUZY_ALLOW_SIGNUP=0.
  signupEnabled?: boolean
  authenticated: boolean
  email: string | null
  desktop?: boolean
}

function Centered({ children }: { children: ReactNode }) {
  // dvh, not vh: on mobile the collapsing URL bar and the software keyboard both
  // change the viewport, and 100vh leaves the card parked mid-scroll.
  return (
    <main className="min-h-dvh flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  )
}

interface AuthFormProps {
  /** 'signup' creates an account; 'login' signs into an existing one. */
  mode: 'signup' | 'login'
  onAuthed: () => void
  /** /api/auth/status already knows the caller is remote and unclaimed. */
  codeRequiredUpFront?: boolean
  /** Show the Sign in / Create account switch above the card. */
  showTabs?: boolean
}

function AuthForm({ mode, onAuthed, codeRequiredUpFront = false, showTabs = false }: AuthFormProps) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [setupCode, setSetupCode] = useState('')
  // Shown from the start when the server already knows a code is needed from
  // this browser; otherwise revealed after the server asks for it (a remote
  // caller whose status was cached as local). A browser on the same machine as
  // the server never sees this field.
  const [codeRequired, setCodeRequired] = useState(codeRequiredUpFront)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [showForgot, setShowForgot] = useState(false)

  const isSignup = mode === 'signup'

  // Inline field feedback; the server stays authoritative. Only the setup form
  // enforces the password minimum client-side (an existing password of any
  // length must still be able to log in). The same goes for the email shape:
  // the desktop app's hidden account is `desktop@localhost` (no TLD), which
  // the login route accepts on purpose (server/src/routes/auth.ts), so a
  // browser tab must be able to submit it after a password reset (#1250).
  const emailError = !email.trim()
    ? t('validation.required')
    : isSignup && !isEmail(email)
      ? t('validation.email')
      : null
  const passwordError = !password
    ? t('validation.required')
    : isSignup && password.length < PASSWORD_MIN
      ? t('validation.passwordMin', { min: PASSWORD_MIN })
      : null

  // Only enforced once the server has said this browser needs a code, so a
  // local (loopback) first run is never asked for one.
  const codeError = codeRequired && !setupCode.trim() ? t('validation.required') : null

  const showEmailError = attempted && !!emailError
  const showPasswordError = attempted && !!passwordError
  const showCodeError = attempted && !!codeError

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (emailError || passwordError || codeError) {
      setAttempted(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload: Record<string, string> = { email, password }
      // Only the setup flow carries a code, and only once the server has asked
      // for it. The server ignores it for local (loopback) setup.
      if (isSignup && setupCode) payload.setupCode = setupCode.trim()
      const res = await apiFetch<{ token: string }>(isSignup ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setToken(res.token)
      onAuthed()
    } catch (err) {
      // The server gates remote first-run setup behind a one-time code; reveal
      // the field so the operator can paste the code from the server logs.
      if (isSignup && (err as ApiError).code === 'setup_code_required') {
        setCodeRequired(true)
      }
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (showForgot && !isSignup) {
    return <ForgotPasswordForm onBack={() => setShowForgot(false)} onAuthed={onAuthed} />
  }

  return (
    <Centered>
      <div className="mb-6 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-foreground" />
          <span className="font-semibold tracking-tight text-sm">Fluzy AI</span>
        </div>
        <span className="ms-4 text-[11px] text-muted-foreground">Developed by Ritam Das</span>
      </div>
      <div className="rounded-3xl border bg-card p-6">
        {showTabs && (
          <div role="tablist" aria-label={t('auth.signIn')} className="mb-6 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
            <Link
              to="/login"
              role="tab"
              aria-selected={!isSignup}
              className={`rounded-xl px-3 py-1.5 text-center text-xs font-medium transition-colors ${!isSignup ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t('auth.signIn')}
            </Link>
            <Link
              to="/signup"
              role="tab"
              aria-selected={isSignup}
              className={`rounded-xl px-3 py-1.5 text-center text-xs font-medium transition-colors ${isSignup ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t('auth.createAccount')}
            </Link>
          </div>
        )}
        <h1 className="text-lg font-semibold tracking-tight">{isSignup ? t('auth.createYourAccount') : t('auth.signIn')}</h1>
        <p className="text-sm text-muted-foreground mt-1.5 mb-6">
          {isSignup ? t('auth.setupDescription') : t('auth.loginDescription')}
        </p>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="auth-email">{t('auth.email')}</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              aria-invalid={showEmailError}
              aria-describedby={showEmailError ? 'auth-email-error' : undefined}
            />
            {attempted && <FieldError id="auth-email-error" error={emailError} />}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="auth-password">{t('auth.password')}</Label>
            <PasswordInput
              id="auth-password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isSignup ? t('auth.passwordPlaceholderSetup') : t('auth.passwordPlaceholderLogin')}
              aria-invalid={showPasswordError}
              aria-describedby={showPasswordError ? 'auth-password-error' : undefined}
            />
            {attempted && <FieldError id="auth-password-error" error={passwordError} />}
          </div>
          {isSignup && codeRequired && (
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="auth-setup-code">{t('auth.setupCode')}</Label>
              <Input
                id="auth-setup-code"
                type="text"
                autoComplete="off"
                value={setupCode}
                onChange={e => setSetupCode(e.target.value)}
                placeholder={t('auth.setupCodePlaceholder')}
                aria-invalid={showCodeError}
                aria-describedby={showCodeError ? 'auth-setup-code-hint auth-setup-code-error' : 'auth-setup-code-hint'}
              />
              <p id="auth-setup-code-hint" className="text-xs text-muted-foreground">{t('auth.setupCodeHint')}</p>
              {showCodeError && <FieldError id="auth-setup-code-error" error={codeError} />}
            </div>
          )}
          {/* A server rejection is the one error nobody can predict; it gets the same
              announcement and the same visual weight as the inline field errors. */}
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full h-10" disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {busy ? (isSignup ? t('auth.creating') : t('auth.signingIn')) : isSignup ? t('auth.createAccount') : t('auth.signIn')}
          </Button>
        </form>
        {!isSignup && (
          <button
            type="button"
            onClick={() => setShowForgot(true)}
            className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('auth.forgotPassword')}
          </button>
        )}
      </div>
    </Centered>
  )
}

// Forgot / Reset password flow

type ForgotStep = 'request' | 'reset' | 'done'

function ForgotPasswordForm({ onBack, onAuthed }: { onBack: () => void; onAuthed: () => void }) {
  const { t } = useI18n()
  const [step, setStep] = useState<ForgotStep>('request')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const passwordError = !newPassword
    ? t('validation.required')
    : newPassword.length < PASSWORD_MIN
      ? t('validation.passwordMin', { min: PASSWORD_MIN })
      : null
  const codeError = !resetCode.trim() ? t('validation.required') : null

  async function requestCode() {
    setBusy(true)
    setError('')
    try {
      await apiFetch('/api/auth/forgot-password', { method: 'POST' })
      setStep('reset')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault()
    if (codeError || passwordError) {
      setAttempted(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch<{ token?: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ resetCode: resetCode.trim(), newPassword }),
      })
      // The server signs the operator in after a reset, so nobody has to
      // remember which email the account uses (#1477).
      if (res.token) {
        setToken(res.token)
        onAuthed()
        return
      }
      setStep('done')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      <div className="mb-6 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-foreground" />
          <span className="font-semibold tracking-tight text-sm">Fluzy AI</span>
        </div>
        <span className="ms-4 text-[11px] text-muted-foreground">Developed by Ritam Das</span>
      </div>
      <div className="rounded-3xl border bg-card p-6">
        <h1 className="text-base font-medium">{t('auth.forgotPassword')}</h1>

        {step === 'request' && (
          <div className="mt-1 space-y-3">
            <p className="text-xs text-muted-foreground mb-4">{t('auth.forgotPasswordDescription')}</p>
            {error && <p className="text-destructive text-xs">{error}</p>}
            <Button className="w-full" disabled={busy} onClick={requestCode}>
              {busy ? t('auth.requestingResetCode') : t('auth.requestResetCode')}
            </Button>
          </div>
        )}

        {step === 'reset' && (
          <form onSubmit={submitReset} className="space-y-3 mt-4" noValidate>
            <p className="text-xs text-muted-foreground">{t('auth.resetCodeHint')}</p>
            <p className="text-xs text-muted-foreground">{t('auth.resetCodeDockerHint')}</p>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="reset-code">{t('auth.resetCode')}</Label>
              <Input
                id="reset-code"
                type="text"
                autoComplete="off"
                value={resetCode}
                onChange={e => setResetCode(e.target.value)}
                placeholder={t('auth.resetCodePlaceholder')}
                aria-invalid={attempted && !!codeError}
              />
              {attempted && <FieldError error={codeError} />}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="reset-new-password">{t('auth.newPassword')}</Label>
              <PasswordInput
                id="reset-new-password"
                autoComplete="new-password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholderSetup')}
                aria-invalid={attempted && !!passwordError}
              />
              {attempted && <FieldError error={passwordError} />}
            </div>
            {error && <p className="text-destructive text-xs">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t('auth.resettingPassword') : t('auth.resetPassword')}
            </Button>
          </form>
        )}

        {step === 'done' && (
          <p className="text-xs text-muted-foreground mt-1 mb-4">{t('auth.passwordReset')}</p>
        )}

        <button
          type="button"
          onClick={onBack}
          className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t('auth.backToLogin')}
        </button>
      </div>
    </Centered>
  )
}

// Change-credentials modal (rendered inside the authenticated shell)

interface ChangeCredentialsModalProps {
  mode: 'password' | 'email'
  onClose: () => void
}

export function ChangeCredentialsModal({ mode, onClose }: ChangeCredentialsModalProps) {
  const { t } = useI18n()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newValue, setNewValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const isPassword = mode === 'password'

  const newValueError = !newValue.trim()
    ? t('validation.required')
    : isPassword && newValue.length < PASSWORD_MIN
      ? t('validation.passwordMin', { min: PASSWORD_MIN })
      : !isPassword && !isEmail(newValue)
        ? t('validation.email')
        : null
  const currentPwError = !currentPassword ? t('validation.required') : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (newValueError || currentPwError) {
      setAttempted(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      if (isPassword) {
        await apiFetch('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword: newValue }),
        })
        toast.success(t('auth.passwordChanged'))
      } else {
        await apiFetch('/api/auth/change-email', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newEmail: newValue }),
        })
        toast.success(t('auth.emailChanged'))
      }
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-3xl border bg-card p-6 shadow-xl">
        <h2 className="text-base font-medium mb-1">
          {isPassword ? t('auth.changePassword') : t('auth.changeEmail')}
        </h2>
        <form onSubmit={submit} className="space-y-3 mt-4" noValidate>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="cred-current-password">{t('auth.currentPassword')}</Label>
            <PasswordInput
              id="cred-current-password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholderLogin')}
              aria-invalid={attempted && !!currentPwError}
            />
            {attempted && <FieldError error={currentPwError} />}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="cred-new-value">
              {isPassword ? t('auth.newPassword') : t('auth.newEmail')}
            </Label>
            {isPassword ? <PasswordInput
              id="cred-new-value"
              autoComplete="new-password"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              placeholder={t('auth.passwordPlaceholderSetup')}
              aria-invalid={attempted && !!newValueError}
            /> : <Input
              id="cred-new-value"
              type="email"
              autoComplete="email"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              aria-invalid={attempted && !!newValueError}
            />}
            {attempted && <FieldError error={newValueError} />}
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy
                ? (isPassword ? t('auth.changingPassword') : t('auth.changingEmail'))
                : t('common.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Shown instead of the create-account form when this deployment already has its
 * account and the operator has not enabled extra signups. Explaining the rule
 * beats a form that submits and returns 403.
 */
function SignupClosedPanel() {
  const { t } = useI18n()
  return (
    <Centered>
      <div className="mb-6 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-foreground" />
          <span className="font-semibold tracking-tight text-sm">Fluzy AI</span>
        </div>
        <span className="ms-4 text-[11px] text-muted-foreground">Developed by Ritam Das</span>
      </div>
      <div className="rounded-3xl border bg-card p-6">
        <h1 className="text-lg font-semibold tracking-tight">{t('auth.signupClosedTitle')}</h1>
        <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{t('auth.signupClosedBody')}</p>
        <Link to="/login" className={buttonVariants({ className: 'w-full' })}>
          {t('auth.signIn')}
          <ArrowRight className="ms-1.5 size-3.5" aria-hidden />
        </Link>
        <Link
          to="/"
          className="mt-3 block w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('auth.backToHome')}
        </Link>
      </div>
    </Centered>
  )
}

/**
 * The signed-out half of the app: a public home page plus the two auth routes.
 *
 * These are real routes (not local state) so the sign-in page can be linked,
 * bookmarked and reloaded, and so the browser's back button works between the
 * landing page and the forms. Anything else redirects home: a deep link to a
 * dashboard page nobody is signed in for should introduce the product, not
 * bounce off a 401.
 */
function PublicRoutes({ status, onAuthed }: { status: AuthStatus; onAuthed: () => void }) {
  const location = useLocation()
  // A fresh deployment has no account to sign in with, so /login is the
  // create-account form and the two auth routes mean the same thing.
  if (status.needsSetup && location.pathname === '/login') {
    return <Navigate to="/signup" replace />
  }
  return (
    <Routes>
      <Route path="/" element={<LandingPage needsSetup={status.needsSetup} />} />
      <Route
        path="/login"
        element={
          <AuthForm
            mode="login"
            onAuthed={onAuthed}
            showTabs
          />
        }
      />
      <Route
        path="/signup"
        element={
          status.needsSetup ? (
            <AuthForm
              mode="signup"
              onAuthed={onAuthed}
              codeRequiredUpFront={!!status.setupCodeRequired}
            />
          ) : status.signupEnabled === false ? (
            <SignupClosedPanel />
          ) : (
            <AuthForm mode="signup" onAuthed={onAuthed} showTabs />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const location = useLocation()
  const { data, isLoading, isError, refetch } = useQuery<AuthStatus>({
    queryKey: ['auth-status'],
    queryFn: () => apiFetch('/api/auth/status'),
    retry: false,
  })

  useEffect(() => {
    const handler = () => { refetch() }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [refetch])

  // Desktop self-repair: one attempt at a time, and none after the shell has
  // handed back a session the server still rejects — a broken install shows a
  // message instead of looping.
  const desktopSession = desktopSessionBridge() ?? (data?.desktop ? browserDesktopSession : null)
  const desktopNeedsSession = !!desktopSession && !!data && (data.needsSetup || !data.authenticated)
  const repairing = useRef(false)
  const [repairFailed, setRepairFailed] = useState(false)
  useEffect(() => {
    if (!desktopNeedsSession || !desktopSession || repairing.current || repairFailed) return
    repairing.current = true
    ;(async () => {
      try {
        const token = await desktopSession()
        if (!token) throw new Error('empty session token')
        setToken(token)
        queryClient.invalidateQueries()
        const next = await refetch()
        if (!next.data?.authenticated) setRepairFailed(true)
      } catch (err) {
        console.error('[auth-gate] desktop session repair failed', err)
        setRepairFailed(true)
      } finally {
        repairing.current = false
      }
    })()
  }, [desktopNeedsSession, desktopSession, repairFailed, queryClient, refetch])

  const navigate = useNavigate()

  function onAuthed() {
    // New session: drop any cached (unauthenticated) data and re-check status.
    // The browser is still on /login or /signup, which the signed-in shell does
    // not route, so move it to the dashboard first.
    if (location.pathname !== '/') navigate('/', { replace: true })
    queryClient.invalidateQueries()
    refetch()
  }

  if (isLoading) {
    return (
      <Centered>
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t('auth.loading')}
        </p>
      </Centered>
    )
  }
  if (isError || !data) {
    return (
      <Centered>
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          {t('auth.serverUnreachableBefore')}<code className="font-mono">npm run dev</code>{t('auth.serverUnreachableAfter')}
        </div>
      </Centered>
    )
  }

  if (desktopNeedsSession) {
    if (repairFailed) {
      return (
        <Centered>
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            {t('auth.desktopSessionFailed')}
          </div>
        </Centered>
      )
    }
    return <Centered><p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden />{t('auth.loading')}</p></Centered>
  }
  if (!data.authenticated) return <PublicRoutes status={data} onAuthed={onAuthed} />

  return <>{children}</>
}

