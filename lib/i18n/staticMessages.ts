// The catalogue, read outside React.
//
// lib/i18n/translate.ts describes the preferred shape — a pure module takes a
// `Translate` function from its caller. That works when the caller is a
// component. It does not work for the three places that build user-facing copy
// with no component anywhere on the stack:
//
//   - lib/notifications/syncReminders.ts schedules OS notifications from a
//     background sync, not a render.
//   - lib/notifications/actionTypes.ts registers iOS notification-action titles
//     once at boot.
//   - lib/translateBackendError.ts is called from ~33 catch blocks and mutation
//     callbacks; threading a translator through all of them would put an i18n
//     argument on every error path in the app to serve one lookup.
//
// So they read the catalogue directly against the live locale. This is the same
// non-hook escape hatch `currentLocale()` was written for (see its doc comment,
// which names lib/toast.ts and notifications).
//
// LOOKUP ONLY — no ICU formatting. next-intl owns interpolation and plurals, and
// none of the messages reached this way carry a placeholder. If one ever needs
// `{count}`, that is the signal it belongs in a component with `useTranslations`
// rather than here.

import { currentLocale } from '@/lib/i18n/localeStore'
import { messagesFor, type Messages } from '@/lib/i18n/messages'

export function staticMessages(): Messages {
  return messagesFor(currentLocale())
}
