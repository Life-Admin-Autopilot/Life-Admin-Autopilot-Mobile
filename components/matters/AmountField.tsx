'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { toMajorString, toMinorUnits } from '@/lib/i18n/numberFormat'
import type { MoneyInput } from '@/queries/tasks'

/**
 * Currency codes offered as suggestions.
 *
 * A `datalist`, not a `select`: the field accepts any ISO 4217 code, and a
 * closed dropdown would make a matter in a currency we forgot to list
 * unenterable. These are the ones a user of this app most likely needs first.
 */
const SUGGESTED = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED'] as const

const DEFAULT_CURRENCY = 'EGP'

/**
 * What a matter costs, typed by a person.
 *
 * <p>Two inputs rather than one parsed string. "480 EGP" in a single box means
 * guessing where the number ends, and guessing wrong on money is the failure
 * this whole feature is built to avoid — so the figure and the currency are
 * asked for separately and neither is inferred.</p>
 *
 * <p>The value handed up is already in minor units, the shape the server
 * stores, so nothing downstream re-parses what the user typed.</p>
 */
export function AmountField({
  value,
  onChange,
}: {
  value: MoneyInput | null
  onChange: (next: MoneyInput | null) => void
}) {
  const t = useTranslations('money')
  const locale = useLocale()
  const listId = useId()

  // The typed text is LOCAL STATE, not derived from the stored minor units.
  // Re-deriving it every render would round-trip each keystroke through a
  // number, which eats a trailing "." and makes "1.50" impossible to type. It
  // is seeded once from whatever the matter already carried.
  const [major, setMajor] = useState(() =>
    value ? toMajorString(value.amountMinor, value.currency, locale) : '',
  )
  const [currency, setCurrency] = useState(value?.currency ?? DEFAULT_CURRENCY)

  function commit(rawMajor: string, rawCurrency: string) {
    setMajor(rawMajor)
    setCurrency(rawCurrency)
    const code = rawCurrency.trim().toUpperCase()
    const minor = toMinorUnits(rawMajor, code || DEFAULT_CURRENCY, locale)

    // An empty or unparseable figure clears the amount rather than storing a
    // zero: a matter that cost nothing and a matter nobody priced are different
    // facts, and only one of them belongs in a spending total.
    onChange(minor === null ? null : { amountMinor: minor, currency: code || DEFAULT_CURRENCY })
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* No visible label of its own: every caller places this inside a
          SheetSection, whose heading already says "Amount", and two identical
          uppercase labels stacked on each other reads as a rendering fault. The
          input keeps an accessible name instead. */}
      <div className="flex gap-2">
        <Input
          aria-label={t('field.label')}
          // `inputMode="decimal"` rather than type="number": a number input
          // silently drops what it cannot parse mid-edit and shows spinners
          // nobody wants on a price, while this keeps the numeric keypad on a
          // phone and leaves the text alone.
          inputMode="decimal"
          value={major}
          placeholder={t('field.placeholder')}
          onChange={(e) => commit(e.target.value, currency)}
          className="flex-1"
        />

        <Input
          aria-label={t('currency.label')}
          list={listId}
          value={currency}
          maxLength={3}
          onChange={(e) => commit(major, e.target.value)}
          className="w-20 uppercase"
        />

        <datalist id={listId}>
          {SUGGESTED.map((code) => (
            <option key={code} value={code} />
          ))}
        </datalist>
      </div>

      <p className="text-body-sm text-ink-muted">{t('field.hint')}</p>
    </div>
  )
}
