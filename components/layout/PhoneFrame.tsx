// Wraps the app in an iPhone-style device frame on desktop viewports (lg+),
// so the mobile-first UI reads as a real app rather than a stretched web page.
// Below `lg` every added class is a no-op — mobile keeps its current full-bleed
// layout untouched.
//
// The frame shell carries `transform-gpu`, which per spec creates a new
// containing block for `position: fixed` descendants (TabBar, ChatIsland,
// VoiceIsland, the toaster) — combined with `overflow-hidden` on that same
// shell, it clips them to the phone instead of the real browser viewport.
//
// The inner content box is a true 390×844 (iPhone-logical) viewport — the
// 10px bezel is added on top via border, not carved out of it, so floating
// UI (bottom tab bar, chat FAB) gets the same side margins it gets on a real
// device instead of being squeezed against the bezel.
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="lg:flex lg:min-h-dvh lg:items-center lg:justify-center lg:bg-canvas-veined lg:p-10">
      <div className="lg:relative lg:h-[864px] lg:w-[410px] lg:overflow-hidden lg:rounded-[52px] lg:border-[10px] lg:border-neutral-900 lg:bg-canvas lg:shadow-2xl lg:ring-1 lg:ring-black/10 lg:transform-gpu">
        {/* Side buttons. These stay physical left/right on purpose — they are
            the volume rocker and power button of a drawn iPhone, and hardware
            does not mirror when the UI does. The only left/right in the app
            that must NOT become start/end. */}
        <div className="pointer-events-none absolute -left-[10px] top-[130px] hidden h-8 w-[3px] rounded-l-sm bg-neutral-900 lg:block" />
        <div className="pointer-events-none absolute -left-[10px] top-[172px] hidden h-14 w-[3px] rounded-l-sm bg-neutral-900 lg:block" />
        <div className="pointer-events-none absolute -left-[10px] top-[236px] hidden h-14 w-[3px] rounded-l-sm bg-neutral-900 lg:block" />
        <div className="pointer-events-none absolute -right-[10px] top-[190px] hidden h-20 w-[3px] rounded-r-sm bg-neutral-900 lg:block" />

        {/* Dynamic-island notch — sits in the top bezel area; content below
            gets pt-8 (see scroll container) so it never overlaps the header. */}
        <div className="pointer-events-none absolute left-1/2 top-[10px] z-50 hidden h-[24px] w-[90px] -translate-x-1/2 rounded-full bg-neutral-900 lg:block" />

        {/* Scrollable app viewport */}
        <div className="lg:h-full lg:overflow-y-auto lg:pt-8 lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
          {children}
        </div>
      </div>
    </div>
  )
}
