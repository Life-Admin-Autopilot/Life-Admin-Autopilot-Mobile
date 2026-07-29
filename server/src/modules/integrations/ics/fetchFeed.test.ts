import { describe, expect, it } from 'vitest'
import { looksLikeICalendar } from './fetchFeed'

describe('looksLikeICalendar', () => {
  it('accepts a real calendar', () => {
    expect(looksLikeICalendar('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR')).toBe(true)
  })

  it('accepts one preceded by a BOM or blank lines', () => {
    expect(looksLikeICalendar('﻿\r\n\r\nBEGIN:VCALENDAR\r\n')).toBe(true)
  })

  it('is case-insensitive, as RFC 5545 allows', () => {
    expect(looksLikeICalendar('begin:vcalendar\r\n')).toBe(true)
  })

  it('rejects the login page an expired feed URL serves with a 200', () => {
    // THE silent failure this guard exists for. Parsed as ICS this yields zero
    // events, which is indistinguishable from "no dates this term" — so every
    // reminder quietly disappears and nothing surfaces an error.
    const loginPage = '<!DOCTYPE html><html><body><form>Please sign in</form></body></html>'
    expect(looksLikeICalendar(loginPage)).toBe(false)
  })

  it('rejects JSON error envelopes and empty bodies', () => {
    expect(looksLikeICalendar('{"error":"not found"}')).toBe(false)
    expect(looksLikeICalendar('')).toBe(false)
  })

  it('does not scan an unbounded prefix', () => {
    // The sentinel is mandated to be the first component, so a BEGIN:VCALENDAR
    // buried past 2KB of HTML is not a calendar — it is a page that happens to
    // mention one.
    expect(looksLikeICalendar(`${'x'.repeat(4096)}BEGIN:VCALENDAR`)).toBe(false)
  })
})
