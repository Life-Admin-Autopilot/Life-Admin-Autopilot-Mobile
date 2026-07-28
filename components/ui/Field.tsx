// Labelled form field: caption above, control, error below.
//
// Lifted out of AuthForm, where it lived as a file-local helper, once a second
// surface needed the same shape. The label is `text-label uppercase` and the
// error `text-body-sm text-danger` — matching those by eye in each new form is
// how a design system quietly drifts apart.

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  /** Quiet guidance under the control. Suppressed while an error is showing —
   *  two lines of small print under one input is noise, and the error is the
   *  one the user needs. */
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-label uppercase text-ink-muted">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="text-body-sm text-danger">
          {error}
        </span>
      ) : hint ? (
        <span className="text-body-sm text-ink-muted">{hint}</span>
      ) : null}
    </label>
  )
}
