// The blocking script that sets <html lang dir> before first paint.
//
// Without it, an Arabic user reloading the app gets one frame of LTR English
// chrome before React hydrates and flips direction — the same class of flash
// next-themes solves with its own inline script, and far more violent here
// because direction reflows the entire layout, not just colours.
//
// Generated from LOCALES/LOCALE_META rather than hand-written so the script and
// the catalogue cannot drift apart when a third language lands.

import { DEFAULT_LOCALE, LOCALE_META, LOCALES } from '@/lib/i18n/locales'
import { LOCALE_STORAGE_KEY } from '@/lib/i18n/localeStore'

/**
 * Minified IIFE for `dangerouslySetInnerHTML` in the document head. Reads the
 * stored choice, falls back to the device language, and writes lang/dir.
 * Wrapped in try/catch: Safari private mode throws on localStorage access, and
 * an exception here would block the rest of the document.
 */
export function localePrePaintScript(): string {
  const supported = JSON.stringify(LOCALES)
  const rtl = JSON.stringify(
    LOCALES.filter((locale) => LOCALE_META[locale].dir === 'rtl'),
  )
  const key = JSON.stringify(LOCALE_STORAGE_KEY)
  const fallback = JSON.stringify(DEFAULT_LOCALE)

  return `(function(){try{var S=${supported},R=${rtl},F=${fallback};var v=null;try{v=localStorage.getItem(${key})}catch(e){}if(!v){v=(navigator.languages&&navigator.languages[0])||navigator.language||F}var p=String(v).toLowerCase().split(/[-_]/)[0];if(S.indexOf(p)<0)p=F;var d=document.documentElement;d.lang=p;d.dir=R.indexOf(p)>=0?'rtl':'ltr'}catch(e){}})()`
}
