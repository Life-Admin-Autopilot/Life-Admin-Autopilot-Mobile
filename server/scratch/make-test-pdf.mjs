import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

// Builds a deliberately messy 4-page "household paperwork" scan bundle for
// exercising documentCore end to end. Unlike a single clean bill it stresses
// the parts that actually break: several discrete actionable items on one page,
// all six domains, every priority band, dates written five different ways, one
// item with no date at all, one faded/low-legibility field that should come
// back low-confidence, and ads/boilerplate the extractor must ignore.
//
// Expected: ~10 candidates (cap is MAX_EXTRACTED_CANDIDATES = 15), spread over
// sourcePage 1-4.

const doc = await PDFDocument.create()
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
const regular = await doc.embedFont(StandardFonts.Helvetica)
const italic = await doc.embedFont(StandardFonts.HelveticaOblique)

const LEFT = 60
const RIGHT = 552
const TOP = 742

let page
let y = TOP

const newPage = () => {
  page = doc.addPage([612, 792])
  y = TOP
}

const draw = (text, { size = 11, font = regular, gap = 17, color = rgb(0, 0, 0) } = {}) => {
  page.drawText(text, { x: LEFT, y, size, font, color })
  y -= gap
}

const h1 = (t) => draw(t, { size: 19, font: bold, gap: 14 })
const h2 = (t) => draw(t, { size: 13, font: bold, gap: 22 })
const p = (t, gap) => draw(t, { gap })
const small = (t, gap = 14) => draw(t, { size: 9, color: rgb(0.45, 0.45, 0.45), gap })
// Faded carbon-copy field: legible enough to read, bad enough that the model
// should return low confidence rather than a confident wrong date.
const faded = (t, gap = 16) => draw(t, { size: 10, color: rgb(0.72, 0.72, 0.72), gap })
const ad = (t, gap = 15) => draw(t, { size: 10, font: italic, color: rgb(0.5, 0.5, 0.5), gap })
const space = (n) => {
  y -= n
}
const rule = () => {
  page.drawLine({
    start: { x: LEFT, y: y + 8 },
    end: { x: RIGHT, y: y + 8 },
    thickness: 0.5,
    color: rgb(0.72, 0.72, 0.72),
  })
  y -= 16
}

// ── Page 1 — utility bill, two actions on one page ──────────────────────────
newPage()
h1('City Power & Light')
small('Customer Services · 0800 114 227 · citypowerlight.example')
space(10)
p('Account Number: 88213-4471')
p('Service Address: 14 Maple Street, Apt 3B')
space(8)
rule()

h2('ELECTRICITY BILL — STATEMENT')
p('Billing Period: 01/06/2026 - 30/06/2026')
p('Previous Balance: $0.00')
p('Usage This Period: 412 kWh')
p('Amount Due: $142.37')
p('Payment Due Date: 30/07/2026', 24)

p('FINAL NOTICE: payment was not received for the prior reminder issued', 15)
p('12/07/2026. Failure to pay by the due date above will incur a $25 late', 15)
p('fee and may result in disconnection of supply without further notice.', 26)

rule()
h2('SCHEDULED METER RE-READ')
p('Our technician must access the internal meter to close an estimated')
p('reading dispute. You are required to be present at the property on:', 22)
draw('Wednesday, August 12, 2026 at 9:00 AM', { font: bold, gap: 22 })
p('To rearrange, call 0800 114 227 at least 48 hours in advance.', 26)

ad('Refer a friend to City Power & Light and you BOTH get $20 credit!')
ad('Ask about our Green Tariff — 100% renewable, no switching fee.')
space(6)
small('City Power & Light is a trading name of CPL Energy Ltd, reg. 4471882.')
small('This statement is issued for information. Do not reply to this notice.')

// ── Page 2 — vet clinic, one overdue + one forward-dated ─────────────────────
newPage()
h1('Maple Veterinary Clinic')
small('22 Riverside Way · appointments@mapevet.example · 555-0148')
space(10)
p('Client: M. Whitfield          Patient: "Biscuit" (Domestic Shorthair, 6y)')
space(8)
rule()

h2('STATEMENT OF ACCOUNT — OVERDUE')
p('Invoice #MV-20431   Consultation & dental descale')
p('Amount Outstanding: $86.40')
p('Original Due Date: 10 Jul 2026', 22)
p('This balance is now 14 days past due. Accounts unpaid after 30 days are', 15)
p('referred to our collections partner and a $15 administration charge is', 15)
p('applied. Please settle by card, online, or at reception.', 26)

rule()
h2('VACCINATION REMINDER')
p("Biscuit's rabies booster lapses on 2026-09-03. We recommend booking the")
p('appointment at least two weeks before that date to keep cover continuous.', 22)
p('Also due at the same visit: annual weight and kidney panel check.', 26)

ad('NEW: Puppy & Kitten Club — 3 free nail clips when you join this month.')
space(6)
small('Maple Veterinary Clinic is regulated by the Veterinary Council.')

// ── Page 3 — insurance renewal, deadline + document submission ───────────────
newPage()
h1('Harbour Mutual Insurance')
small('Policy Services · PO Box 1180 · harbourmutual.example')
space(10)
p('Policyholder: M. Whitfield')
p('Policy Number: HM-CAR-77341-B')
p('Vehicle: 2019 Toyota Corolla, reg. KX19 TRP')
space(8)
rule()

h2('MOTOR POLICY RENEWAL NOTICE')
p('Your comprehensive motor policy expires at 23:59 on 1 October 2026.')
p('Renewal Premium: $612.00 annually, or $54.20 per month.', 22)
p('If we do not hear from you before the expiry date your cover will lapse', 15)
p('and you will be driving uninsured. Auto-renewal is NOT enabled on this', 15)
p('policy because you opted out at last renewal.', 26)

rule()
h2('ACTION REQUIRED — PROOF OF NO-CLAIMS')
p('To hold the quoted premium you must send us your no-claims discount')
p('certificate from your previous insurer. We must receive it by:', 22)
draw('8 Aug 2026', { font: bold, gap: 22 })
p('Upload at harbourmutual.example/documents or post to the address above.', 15)
p('Without it the premium will be re-rated, typically by $90-$140.', 26)

ad('Bundle your home and motor cover and save up to 15% — call for a quote.')
space(6)
small('Harbour Mutual Insurance Ltd is authorised and regulated by the FCA.')

// ── Page 4 — mixed household paperwork, incl. no-date + faded field ───────────
newPage()
h1('Household — Miscellaneous')
small('Loose paperwork scanned together, 24/07/2026')
space(10)
rule()

h2('BRIGHTSMILE DENTAL — APPOINTMENT CARD')
p('Patient: M. Whitfield')
p('Routine examination and hygienist appointment confirmed for')
p('Thursday 20 August 2026, 2:30 PM, with Dr. Okafor.', 22)
p('Missed appointments without 24 hours notice are charged at $40.', 26)

rule()
h2('OAKFIELD PRIMARY SCHOOL — ENROLMENT FORM')
p('Return the completed Year 3 enrolment form together with proof of')
p('address and the immunisation record to the school office.')
p('Closing date for returns: 28 August 2026. Late forms are placed on a', 15)
p('waiting list and cannot be guaranteed a place for the autumn term.', 26)

rule()
h2('BOILER — ANNUAL SERVICE')
p('Your warranty requires an annual service by a registered engineer.')
p('No date is scheduled. Call Vale Heating on 555-0192 to arrange a visit')
p('at your convenience; we service the Maple Street area on weekdays.', 26)

rule()
h2('DVLA — VEHICLE TEST REMINDER (carbon copy)')
faded('Vehicle KX19 TRP  ---  annual roadworthiness test due')
faded('date of expiry:  1?/0?/2026    (ink faded, partially illegible)')
faded('Driving without a valid test certificate is an offence.', 24)

space(4)
small('End of scanned bundle — 4 pages.')

const bytes = await doc.save()
await writeFile('scratch/test-bill.pdf', bytes)
console.log('wrote scratch/test-bill.pdf', bytes.length, 'bytes,', doc.getPageCount(), 'pages')
