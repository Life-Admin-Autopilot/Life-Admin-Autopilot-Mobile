import { describe, expect, it } from 'vitest'

import { detectSourceLocale, presentMatter } from './matterLocale'

describe('detectSourceLocale', () => {
  it('reads Arabic script as Arabic', () => {
    expect(detectSourceLocale('دفع فاتورة الكهرباء')).toBe('ar')
  })

  it('reads Latin script as English', () => {
    expect(detectSourceLocale('Pay electricity bill')).toBe('en')
    // Accents are Latin, not another script.
    expect(detectSourceLocale('Café renewal')).toBe('en')
  })

  it('treats a mixed string as Arabic', () => {
    // "Renew جواز السفر" was written by someone working in Arabic who kept an
    // English verb. Filing it as English would translate their own words at them.
    expect(detectSourceLocale('Renew جواز السفر')).toBe('ar')
  })

  it('falls back to English on nothing at all', () => {
    expect(detectSourceLocale(undefined, null, '')).toBe('en')
  })

  it('considers every field it is given', () => {
    expect(detectSourceLocale('Untitled', 'ملاحظات بالعربية')).toBe('ar')
  })
})

describe('presentMatter', () => {
  const base = {
    title: 'Pay electricity bill',
    notes: 'Account 88213-4471',
    sourceLocale: 'en',
    subtasks: [
      { _id: 'a1', text: 'Find the bill' },
      { _id: 'b2', text: 'Pay online' },
    ],
    i18n: {
      ar: {
        title: 'دفع فاتورة الكهرباء',
        notes: 'الحساب 88213-4471',
        subtasks: { a1: 'ابحث عن الفاتورة' },
      },
    },
  }

  it('overlays the reader’s language', () => {
    const shown = presentMatter({ ...base }, 'ar')
    expect(shown.title).toBe('دفع فاتورة الكهرباء')
    expect(shown.notes).toBe('الحساب 88213-4471')
  })

  it('leaves the canonical text alone when reading the source language', () => {
    const shown = presentMatter({ ...base }, 'en')
    expect(shown.title).toBe('Pay electricity bill')
  })

  it('translates subtasks by id, not by position', () => {
    // b2 has no translation, so it keeps its own text rather than inheriting a
    // neighbour's — the failure an index-keyed map would produce after a reorder.
    const shown = presentMatter({ ...base }, 'ar')
    expect(shown.subtasks?.[0]?.text).toBe('ابحث عن الفاتورة')
    expect(shown.subtasks?.[1]?.text).toBe('Pay online')
  })

  it('never ships the other languages to the client', () => {
    expect('i18n' in presentMatter({ ...base }, 'ar')).toBe(false)
    expect('i18n' in presentMatter({ ...base }, 'en')).toBe(false)
  })

  it('falls back to canonical when the language has no copy', () => {
    const shown = presentMatter({ ...base, i18n: {} }, 'ar')
    expect(shown.title).toBe('Pay electricity bill')
  })

  it('does not mistake a missing sourceLocale for the reader’s language', () => {
    // A row predating the field: absent resolves to English, so an Arabic reader
    // still gets the overlay rather than being handed the English canonical.
    const legacy = { ...base, sourceLocale: undefined }
    expect(presentMatter(legacy, 'ar').title).toBe('دفع فاتورة الكهرباء')
  })

  it('keeps a partial translation partial rather than blanking fields', () => {
    const titleOnly = { ...base, i18n: { ar: { title: 'عنوان' } } }
    const shown = presentMatter(titleOnly, 'ar')
    expect(shown.title).toBe('عنوان')
    expect(shown.notes).toBe('Account 88213-4471')
  })
})
