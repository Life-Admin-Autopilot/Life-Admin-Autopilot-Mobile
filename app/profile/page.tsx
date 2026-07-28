'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTheme } from 'next-themes'

import { AppHeader } from '@/components/layout/AppHeader'
import { DeleteAccountSheet } from '@/components/profile/DeleteAccountSheet'
import { DevicesSheet } from '@/components/profile/DevicesSheet'
import { EmailSheet, type EmailSheetMode } from '@/components/profile/EmailSheet'
import { InvoicesSheet } from '@/components/profile/InvoicesSheet'
import { NameSheet } from '@/components/profile/NameSheet'
import { PasswordSheet } from '@/components/profile/PasswordSheet'
import { PlanCard } from '@/components/profile/PlanCard'
import { ProfileIdentity } from '@/components/profile/ProfileIdentity'
import { TimezoneSheet } from '@/components/profile/TimezoneSheet'
import { UpgradeSheet } from '@/components/profile/UpgradeSheet'
import { Button } from '@/components/ui/button'
import { ThemeChoice } from '@/components/ui/ThemeChoice'
import {
  SettingActionRow,
  SettingGroup,
  SettingRow,
  SettingToggleRow,
} from '@/components/ui/SettingRow'
import { selectUser, useSessionStore, type Theme } from '@/lib/auth/sessionStore'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { useExportData } from '@/queries/account'
import { useSignOut } from '@/queries/auth'
import { useSendVerificationCode } from '@/queries/email'
import { useUpdateProfile } from '@/queries/profile'

// The account home. Identity at the top, then grouped rows; every edit opens a
// Sheet that grows out of the row you tapped (AGENTS.md → editing is a sheet,
// never an inline expansion, because a form unfolding inside a list pushes the
// thing you tapped away from your finger).
//
// This page owns only which sheet is open and the rect it should grow from.
// Each sheet owns its own draft, so an abandoned edit cannot leak back here.
//
// On what is NOT here: the backend also stores textSize, mic.quality,
// notifications.emailDigest/marketing and privacy.analytics/crashReports.
// Nothing on either side reads any of them, so there are no controls for them
// — a switch that persists a value no code consumes is a switch that lies.

type SheetName =
  | 'name'
  | 'email'
  | 'password'
  | 'timezone'
  | 'devices'
  | 'plan'
  | 'invoices'
  | 'delete'

export default function ProfilePage() {
  const router = useRouter()
  const user = useSessionStore(selectUser)
  const { theme, setTheme } = useTheme()

  const [open, setOpen] = useState<SheetName | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [emailMode, setEmailMode] = useState<EmailSheetMode>('change')

  const updateProfile = useUpdateProfile()
  const signOut = useSignOut()
  const exportData = useExportData()
  const sendVerificationCode = useSendVerificationCode()

  // RouteGuard has already established there is a session, so a null user here
  // means the store is mid-hydration — render nothing rather than a flash of
  // empty fields.
  if (!user) return null

  const show = (name: SheetName) => (trigger: DOMRect) => {
    setRect(trigger)
    setOpen(name)
  }

  const close = () => setOpen(null)

  const openEmail = (mode: EmailSheetMode) => (trigger: DOMRect) => {
    setEmailMode(mode)
    setRect(trigger)
    setOpen('email')
    // Sending the code belongs to this tap, not to the sheet's render. Opening
    // "confirm your email" is one gesture from the user's side, so the code is
    // already on its way by the time the sheet finishes growing — and it is
    // sent exactly once, which an effect could not promise.
    if (mode === 'verify' && !user.emailVerifiedAt) {
      sendVerificationCode.mutate(undefined, {
        onError: (err) => toast.error(translateBackendError(err, 'We could not send that code.')),
      })
    }
  }

  const pickTheme = (next: Theme) => {
    // next-themes drives the actual appearance; the profile write is what makes
    // the choice survive a reinstall on another device.
    setTheme(next)
    updateProfile.mutate(
      { theme: next },
      { onError: (err) => toast.error(translateBackendError(err, "That didn't save.")) },
    )
  }

  const toggleReminders = (next: boolean) => {
    updateProfile.mutate(
      { notifications: { push: next } },
      { onError: (err) => toast.error(translateBackendError(err, "That didn't save.")) },
    )
  }

  const runExport = () => {
    exportData.mutate(undefined, {
      onSuccess: (destination) => toast.success(`Exported. ${destination.message}`),
      onError: (err) => toast.error(translateBackendError(err, "That didn't export.")),
    })
  }

  const endSession = () => {
    signOut.mutate(undefined, {
      onSuccess: () => {
        toast.success('Signed out.')
        router.replace('/welcome')
      },
    })
  }

  const remindersOn = user.notifications?.push ?? true
  const detectedZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <main className="min-h-dvh pb-32">
      <AppHeader title="Profile" />

      <div className="flex flex-col gap-9 px-5 pt-4">
        <ProfileIdentity user={user} onConfirmEmail={openEmail('verify')} />

        <SettingGroup label="Account">
          <SettingRow
            emoji="😺"
            category="peach"
            title="Name"
            value={user.displayName ?? 'Not set'}
            onOpen={show('name')}
          />
          <SettingRow
            emoji="✉️"
            category="sky"
            title="Email"
            value={user.pendingEmail ? `${user.pendingEmail} — pending` : user.email}
            onOpen={openEmail('change')}
          />
          <SettingRow
            emoji="🔑"
            category="yellow"
            title="Password"
            value="Change"
            onOpen={show('password')}
          />
          <SettingRow
            emoji="🌍"
            category="sage"
            title="Time zone"
            value={(user.timezone ?? detectedZone).replace(/_/g, ' ')}
            onOpen={show('timezone')}
          />
        </SettingGroup>

        <SettingGroup label="Security">
          <SettingRow
            emoji="📱"
            category="periwinkle"
            title="Signed-in devices"
            onOpen={show('devices')}
          />
        </SettingGroup>

        <SettingGroup label="Notifications">
          <SettingToggleRow
            emoji="🔔"
            category="blush"
            title="Reminders"
            meta="A nudge when a matter comes due"
            checked={remindersOn}
            onChange={toggleReminders}
          />
        </SettingGroup>

        <section className="flex flex-col gap-3">
          <h2 className="text-label uppercase text-ink-muted">Appearance</h2>
          <ThemeChoice value={(theme as Theme) ?? 'system'} onChange={pickTheme} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-label uppercase text-ink-muted">Plan</h2>
          <PlanCard onSeePro={show('plan')} />
          <SettingRow
            emoji="🧾"
            category="lilac"
            title="Billing history"
            onOpen={show('invoices')}
          />
        </section>

        <SettingGroup label="Your data">
          <SettingActionRow
            emoji="📦"
            category="sage"
            title="Export your data"
            meta="Everything Kitto holds, as a file"
            pending={exportData.isPending}
            pendingTitle="Preparing…"
            onAction={runExport}
          />
        </SettingGroup>

        <div className="flex flex-col gap-6 pt-2">
          <Button
            variant="secondary"
            className="w-full"
            disabled={signOut.isPending}
            onClick={endSession}
          >
            {signOut.isPending ? 'Signing out…' : 'Sign out'}
          </Button>

          <SettingRow
            emoji="🗑️"
            category="pink"
            title="Delete account"
            tone="danger"
            onOpen={show('delete')}
          />
        </div>
      </div>

      {/* One instance of each, mounted beside the list — never inside a row. */}
      <NameSheet
        open={open === 'name'}
        onClose={close}
        trigger={rect}
        currentName={user.displayName}
      />
      <EmailSheet
        open={open === 'email'}
        onClose={close}
        trigger={rect}
        mode={emailMode}
        user={user}
      />
      <PasswordSheet open={open === 'password'} onClose={close} trigger={rect} />
      <TimezoneSheet
        open={open === 'timezone'}
        onClose={close}
        trigger={rect}
        currentZone={user.timezone}
      />
      <DevicesSheet open={open === 'devices'} onClose={close} trigger={rect} />
      <UpgradeSheet open={open === 'plan'} onClose={close} trigger={rect} />
      <InvoicesSheet open={open === 'invoices'} onClose={close} trigger={rect} />
      <DeleteAccountSheet
        open={open === 'delete'}
        onClose={close}
        trigger={rect}
        // Defaults to true only when the server hasn't told us — asking for a
        // password is the safer wrong guess than skipping the gate entirely.
        hasPassword={user.hasPassword ?? true}
      />
    </main>
  )
}
