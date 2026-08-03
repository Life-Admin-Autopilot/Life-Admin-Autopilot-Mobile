import { describe, expect, it } from 'vitest'

import {
  conversationLanguageRule,
  extractionLanguageRule,
  resolveAiLocale,
} from './promptLanguage'
import { buildSystemPrompt } from './voice/systemPrompt'

// These assert the CONTRACT of the language rules, not their wording: that a
// locale reaches the prompt at all, that the two rule flavours differ in the one
// way that matters, and that the facts-stay-verbatim clause is never dropped.
// The prose is expected to be tuned; the guarantees are not.

describe('resolveAiLocale', () => {
  it('matches on the primary subtag so every Arabic region lands on ar', () => {
    expect(resolveAiLocale('ar')).toBe('ar')
    expect(resolveAiLocale('ar-EG')).toBe('ar')
    expect(resolveAiLocale('ar_SA')).toBe('ar')
    expect(resolveAiLocale('AR-eg')).toBe('ar')
  })

  it('falls back to English rather than throwing on anything it cannot place', () => {
    // Accounts predating the picker have no locale at all, and the digest still
    // has to write something.
    expect(resolveAiLocale(null)).toBe('en')
    expect(resolveAiLocale(undefined)).toBe('en')
    expect(resolveAiLocale('')).toBe('en')
    expect(resolveAiLocale('fr-CA')).toBe('en')
    expect(resolveAiLocale('not a tag')).toBe('en')
  })
})

describe('conversationLanguageRule', () => {
  it('names the language it wants back', () => {
    expect(conversationLanguageRule('ar')).toContain('Arabic')
    expect(conversationLanguageRule('en')).toContain('English')
  })

  it('holds the locale over the language the user typed in', () => {
    // The setting promises it changes "what Kitto writes back", so mirroring the
    // input language would break the one thing the user was told.
    expect(conversationLanguageRule('ar')).toMatch(/even when they write to/i)
  })

  it('pins Western numerals for Arabic only', () => {
    // The app pins -u-nu-latn on every Intl call, so Arabic-Indic digits in prose
    // would disagree with every number rendered beside them.
    expect(conversationLanguageRule('ar')).toContain('0-9')
    expect(conversationLanguageRule('en')).not.toContain('0-9')
  })

  it('keeps names, references and amounts verbatim in both locales', () => {
    for (const rule of [conversationLanguageRule('ar'), conversationLanguageRule('en')]) {
      expect(rule).toMatch(/NEVER translate/)
      expect(rule).toMatch(/reference/i)
      expect(rule).toMatch(/amounts/i)
    }
  })
})

describe('extractionLanguageRule', () => {
  it('refuses to mirror the source language', () => {
    // An Arabic user photographing an English bill must not get an English
    // matter title in an Arabic list.
    const rule = extractionLanguageRule('ar')
    expect(rule).toMatch(/Do NOT mirror/)
    expect(rule).toContain('Arabic')
  })

  it('still protects the facts it is copying', () => {
    expect(extractionLanguageRule('ar')).toMatch(/NEVER translate/)
  })

  it('differs from the conversation rule — the source language only exists here', () => {
    expect(extractionLanguageRule('ar')).not.toBe(conversationLanguageRule('ar'))
  })
})

describe('buildSystemPrompt', () => {
  it('carries the locale into the assistant persona', () => {
    expect(buildSystemPrompt('ar')).toContain('Arabic')
    expect(buildSystemPrompt('ar')).not.toBe(buildSystemPrompt('en'))
  })

  it('keeps the persona and the tool rules in both locales', () => {
    for (const locale of ['ar', 'en'] as const) {
      const prompt = buildSystemPrompt(locale)
      expect(prompt).toContain('You are Kitto')
      expect(prompt).toContain('LANGUAGE — ABSOLUTE')
    }
  })

  it('puts the language rule last, after the tool rules it governs', () => {
    // Recency: the rule constrains every string the tool rules produce, so it
    // has to be the final thing the model reads.
    const prompt = buildSystemPrompt('ar')
    expect(prompt.indexOf('LANGUAGE — ABSOLUTE')).toBeGreaterThan(prompt.indexOf('You are Kitto'))
    expect(prompt.trimEnd().endsWith(conversationLanguageRule('ar').trimEnd())).toBe(true)
  })
})
