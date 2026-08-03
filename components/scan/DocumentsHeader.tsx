'use client'

// The /documents chrome: the app's standard AppHeader, with this screen's own
// controls in a sticky row underneath — the exact arrangement /matters uses for
// its filter pills, and the same header the dashboard wears.
//
// It used to be a bespoke header — a big left-aligned title where the centred
// serif one goes, and a scan puck sitting where the theme and notification
// pucks live everywhere else. That made /documents the one screen whose top
// didn't look like the app, and it left the shared pucks nowhere to go. The
// scan action moves down into the control row, where it also gets to say what
// it does instead of being a bare glyph.
//
// Selection REPLACES the control row rather than adding a row beneath it. An
// added row pushes the whole list down the moment the mode is entered, which
// moves every row out from under the finger that is about to tap one — the
// exact failure the swap is meant to avoid. Both states are one `h-10` line, so
// nothing below moves.
//
// There is still no Select button: selection is entered by pressing and holding
// a row (see DocumentRow), which is where the user's finger already is when
// they decide they want to act on that document.

import { ScanLine } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { AppHeader } from '@/components/layout/AppHeader'
import { Button } from '@/components/ui/button'
import { SelectionToolbar } from '@/components/ui/SelectionToolbar'

export function DocumentsHeader({
  selectMode,
  count,
  allSelected,
  onCancelSelect,
  onSelectAll,
  onScan,
}: {
  selectMode: boolean
  count: number
  allSelected: boolean
  onCancelSelect: () => void
  onSelectAll: () => void
  /** Receives the button's rect so the capture flow morphs out of it. */
  onScan: (rect: DOMRect) => void
}) {
  const t = useTranslations('scan')

  return (
    <>
      <AppHeader title={t('header.title')} />

      <div className="sticky top-0 z-20 bg-canvas/95 px-5 py-3 backdrop-blur-xl">
        {selectMode ? (
          <SelectionToolbar
            subjectLabel={t('header.selectionSubject')}
            count={count}
            allSelected={allSelected}
            onSelectAll={onSelectAll}
            onCancel={onCancelSelect}
          />
        ) : (
          /* Full width, not a chip parked in the corner. This is the only
             thing you can DO on this screen, and a short pill floating at one
             end of an empty row reads as a leftover control rather than the
             page's action. */
          <Button
            variant="solid"
            className="h-10 w-full"
            onClick={(e) => onScan(e.currentTarget.getBoundingClientRect())}
          >
            <ScanLine />
            {t('header.scan')}
          </Button>
        )}
      </div>
    </>
  )
}
