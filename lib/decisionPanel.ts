// How long a decision panel stays on screen.
//
// One number with one reason, because three surfaces now raise the same panel —
// the voice clash, the voice missing-date question, and a bell answer that turns
// out to clash — and a panel that lingers for six seconds in one place and two in
// another reads as three features rather than one.
//
// Long enough to read two matter names and reach a button without hurrying, and
// short enough that someone who has already decided is not made to dismiss it.
//
// It is only safe to pass at all because every decision it carries survives the
// panel: a clash stays on the dashboard and in the conflicts sheet, and a voice
// question stays in the bell and the uncertainty stack. See the note on
// `decide()` in lib/toast.ts for the rule — pass a duration only once you can
// name where the decision still lives afterwards.
export const CLASH_PANEL_MS = 6_000
