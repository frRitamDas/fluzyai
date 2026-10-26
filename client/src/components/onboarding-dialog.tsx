import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Copy, KeyRound, Terminal, Waypoints } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { toast } from '@/lib/toast'

/**
 * First sign-in walkthrough.
 *
 * A fresh dashboard is a lot of empty tables: no provider keys, no traffic, and
 * a unified key nobody has copied yet. This shows the three things that turn it
 * into a working endpoint, once per browser — dismissing it (or finishing it) is
 * remembered in localStorage, so it never nags an established install. The
 * dashboard's own empty states still explain each page; this is only the map.
 */
const SEEN_KEY = 'fluzyai.onboarded'

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    // Private mode / storage disabled: showing it every session is worse than
    // never showing it, so treat it as seen.
    return true
  }
}

export function OnboardingDialog() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(() => !alreadySeen())
  const baseUrl = `${window.location.origin}/v1`

  function dismiss() {
    try {
      window.localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* storage unavailable: closing still closes */
    }
    setOpen(false)
  }

  async function copyBaseUrl() {
    try {
      await navigator.clipboard.writeText(baseUrl)
      toast.success(t('onboarding.copied'))
    } catch {
      toast.error(t('onboarding.copyFailed'))
    }
  }

  const steps = [
    { icon: KeyRound, title: t('onboarding.step1Title'), body: t('onboarding.step1Body') },
    { icon: Waypoints, title: t('onboarding.step2Title'), body: t('onboarding.step2Body') },
    { icon: Terminal, title: t('onboarding.step3Title'), body: t('onboarding.step3Body') },
  ]

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) dismiss() }}>
      <DialogPopup maxWidth="max-w-md">
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-foreground" />
          <span className="font-semibold tracking-tight text-sm">Fluzy AI</span>
          <span className="text-[11px] text-muted-foreground">Developed by Ritam Das</span>
        </div>
        <DialogTitle className="text-lg font-semibold tracking-tight">{t('onboarding.title')}</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {t('onboarding.subtitle')}
        </DialogDescription>

        <ol className="mt-5 space-y-4">
          {steps.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium">
                {index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  {title}
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-4 flex items-center gap-2 rounded-2xl border bg-muted/40 px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{baseUrl}</code>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={copyBaseUrl}>
            <Copy className="size-3.5" aria-hidden />
            <span className="ms-1 text-[11px]">{t('onboarding.copyBaseUrl')}</span>
          </Button>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button
            className="flex-1"
            onClick={() => {
              dismiss()
              navigate('/keys')
            }}
          >
            {t('onboarding.openKeys')}
            <ArrowRight className="ms-1.5 size-3.5" aria-hidden />
          </Button>
          <Button variant="ghost" className="flex-1" onClick={dismiss}>
            <Check className="me-1.5 size-3.5" aria-hidden />
            {t('onboarding.explore')}
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  )
}

export default OnboardingDialog
