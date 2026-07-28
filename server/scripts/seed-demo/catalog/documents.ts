import type { Domain } from '../../../src/models/User'
import type { DocumentType } from '../../../src/models/ScannedDocument'
import type { TaskPriority } from '../../../src/models/Task'

// The paperwork that comes through a household's door, and what Kitto's
// vision pass would have pulled out of each one.

export interface DocCandidateTemplate {
  title: string
  domain: Domain
  priority: TaskPriority
  estimate: [number, number]
  /** Days after the document's own date. */
  dueOffset: number
}

export interface DocumentTemplate {
  id: string
  type: DocumentType
  issuer: string
  /** The list row's headline. Kept short — DOCUMENT_TITLE_MAX is 60. */
  documentTitle: string
  heading: string
  contact: string
  summary: string
  /** `[amountMin, amountMax]` in EGP, when the document carries a figure. */
  amount?: [number, number]
  fields: [string, string][]
  body: string[]
  footer: string
  candidates: DocCandidateTemplate[]
  /** Roughly how often this kind of paper turns up. */
  weight: number
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'electricity',
    type: 'bill',
    issuer: 'North Cairo Electricity Distribution',
    documentTitle: 'Electricity bill',
    heading: 'North Cairo Electricity Distribution',
    contact: 'Customer service 121 · northcairo-elec.example',
    summary:
      'A monthly electricity statement for the Heliopolis flat, with the meter reading and the amount to settle before the due date.',
    amount: [380, 1250],
    fields: [
      ['Account number', '4471-88213'],
      ['Service address', '14 El Merghany St, Apt 6'],
      ['Meter reading', '{METER} kWh'],
      ['Amount due', '{AMOUNT}'],
      ['Payment due date', '{DUE}'],
    ],
    body: [
      'Payment may be made through any Fawry outlet, the mobile app, or the',
      'district office. Late settlement adds a reconnection charge and may',
      'result in supply interruption without a further notice.',
    ],
    footer: 'This statement is issued for information. Do not reply to this notice.',
    candidates: [
      {
        title: 'Pay the electricity bill',
        domain: 'finance',
        priority: 'high',
        estimate: [5, 15],
        dueOffset: 14,
      },
    ],
    weight: 8,
  },
  {
    id: 'vet',
    type: 'medical',
    issuer: 'Maadi Vet Clinic',
    documentTitle: 'Vet visit summary',
    heading: 'Maadi Vet Clinic',
    contact: '22 Road 9, Maadi · 0100 555 0148',
    summary:
      'A visit summary for Basbousa with the treatment given, the follow-up the vet wants, and the date her next booster is due.',
    amount: [500, 900],
    fields: [
      ['Client', 'Mina'],
      ['Patient', 'Basbousa — DSH, female'],
      ['Seen by', 'Dr Amira'],
      ['Paid today', '{AMOUNT}'],
      ['Next booster due', '{DUE}'],
    ],
    body: [
      'Weight stable. Dental scale recommended within six months.',
      'Continue the current food. Return sooner if appetite drops again.',
      'Booster cover lapses on the date above — book two weeks ahead.',
    ],
    footer: 'Maadi Vet Clinic is registered with the Egyptian Veterinary Syndicate.',
    candidates: [
      {
        title: 'Book Basbousa’s booster',
        domain: 'pets',
        priority: 'high',
        estimate: [15, 30],
        dueOffset: 21,
      },
      {
        title: 'Book Basbousa a dental scale',
        domain: 'pets',
        priority: 'normal',
        estimate: [15, 30],
        dueOffset: 60,
      },
    ],
    weight: 4,
  },
  {
    id: 'insurance',
    type: 'insurance',
    issuer: 'Misr Insurance',
    documentTitle: 'Car policy renewal',
    heading: 'Misr Insurance',
    contact: 'Policy services · misrinsurance.example',
    summary:
      'The motor policy renewal notice. Cover lapses on the expiry date and auto-renewal is not switched on for this policy.',
    amount: [6500, 9200],
    fields: [
      ['Policyholder', 'Mina'],
      ['Policy number', 'MI-CAR-77341-B'],
      ['Vehicle', '2019 Toyota Corolla'],
      ['Renewal premium', '{AMOUNT}'],
      ['Cover expires', '{DUE}'],
    ],
    body: [
      'Auto-renewal is NOT enabled on this policy. If we do not hear from you',
      'before the expiry date above, cover ends and the vehicle is uninsured.',
      'To hold the quoted premium, send the no-claims certificate beforehand.',
    ],
    footer: 'Misr Insurance is regulated by the Financial Regulatory Authority.',
    candidates: [
      {
        title: 'Renew the car insurance',
        domain: 'car',
        priority: 'urgent',
        estimate: [60, 90],
        dueOffset: 25,
      },
      {
        title: 'Send the no-claims certificate',
        domain: 'car',
        priority: 'high',
        estimate: [15, 30],
        dueOffset: 10,
      },
    ],
    weight: 3,
  },
  {
    id: 'school',
    type: 'letter',
    issuer: 'Nefertari International School',
    documentTitle: 'School fees notice',
    heading: 'Nefertari International School',
    contact: 'Bursary office · 02 2618 4400',
    summary:
      'The term fee instalment notice, with the amount, the deadline, and the late charge that applies after it.',
    amount: [14000, 19500],
    fields: [
      ['Student', 'Nour'],
      ['Year group', 'Year 5'],
      ['Instalment', '{AMOUNT}'],
      ['Payable by', '{DUE}'],
    ],
    body: [
      'Payment by bank transfer to the school account, quoting the student',
      'number as the reference. A 2% late charge applies after the date above.',
      'Receipts are issued by email within three working days.',
    ],
    footer: 'Please retain this notice for your records.',
    candidates: [
      {
        title: 'Pay the school fees instalment',
        domain: 'family',
        priority: 'urgent',
        estimate: [15, 30],
        dueOffset: 18,
      },
    ],
    weight: 4,
  },
  {
    id: 'lab',
    type: 'medical',
    issuer: 'Al Mokhtabar',
    documentTitle: 'Lab results',
    heading: 'Al Mokhtabar Laboratories',
    contact: 'Branch: Nasr City · almokhtabar.example',
    summary:
      'A blood panel result sheet. Two markers are flagged outside the reference range with a note to follow up.',
    fields: [
      ['Patient', 'Mina'],
      ['Sample taken', '{ISSUED}'],
      ['Panel', 'Full blood count + lipids'],
      ['Flagged', 'Vitamin D (low), LDL (high)'],
    ],
    body: [
      'Two results fall outside the reference range and are marked on page one.',
      'Discuss with your treating physician before changing any medication.',
      'Results remain available in the portal for twelve months.',
    ],
    footer: 'Results are not a diagnosis. Consult your doctor.',
    candidates: [
      {
        title: 'Send the blood results to Dr Yassin',
        domain: 'health',
        priority: 'high',
        estimate: [10, 15],
        dueOffset: 5,
      },
      {
        title: 'Start the vitamin D course',
        domain: 'health',
        priority: 'normal',
        estimate: [5, 10],
        dueOffset: 7,
      },
    ],
    weight: 4,
  },
  {
    id: 'bank',
    type: 'statement',
    issuer: 'CIB',
    documentTitle: 'Card statement',
    heading: 'Commercial International Bank',
    contact: 'cibeg.example · 19666',
    summary:
      'The monthly credit card statement, with the closing balance, the minimum payment, and the date the interest-free period ends.',
    amount: [2400, 9800],
    fields: [
      ['Card ending', '4402'],
      ['Statement balance', '{AMOUNT}'],
      ['Minimum payment', '{MIN}'],
      ['Payment due', '{DUE}'],
    ],
    body: [
      'Paying the full statement balance by the due date avoids all interest.',
      'Paying only the minimum carries the remaining balance at the standard',
      'rate from the transaction date, not the statement date.',
    ],
    footer: 'CIB is regulated by the Central Bank of Egypt.',
    candidates: [
      {
        title: 'Settle the credit card statement',
        domain: 'finance',
        priority: 'urgent',
        estimate: [10, 15],
        dueOffset: 12,
      },
    ],
    weight: 6,
  },
  {
    id: 'maintenance',
    type: 'receipt',
    issuer: 'Ghabbour service centre',
    documentTitle: 'Car service receipt',
    heading: 'Ghabbour Auto — Service Centre',
    contact: 'Km 28 Cairo–Alex Road · 16661',
    summary:
      'The receipt for the last full service, listing what was replaced and the mileage the next one is due at.',
    amount: [2200, 3600],
    fields: [
      ['Vehicle', '2019 Toyota Corolla'],
      ['Mileage', '{METER} km'],
      ['Work done', 'Oil, filters, brake check'],
      ['Total paid', '{AMOUNT}'],
      ['Next service due', '{DUE}'],
    ],
    body: [
      'Brake pads at approximately 40% — replacement advised at the next visit.',
      'Front wiper blades are perished and were not replaced at this service.',
      'Keep this receipt: the warranty requires a documented service history.',
    ],
    footer: 'Parts carry a six-month warranty from the date of fitting.',
    candidates: [
      {
        title: 'Replace the wiper blades',
        domain: 'car',
        priority: 'normal',
        estimate: [30, 45],
        dueOffset: 14,
      },
      {
        title: 'Book the next car service',
        domain: 'car',
        priority: 'normal',
        estimate: [10, 15],
        dueOffset: 150,
      },
    ],
    weight: 3,
  },
  {
    id: 'tax',
    type: 'tax',
    issuer: 'Egyptian Tax Authority',
    documentTitle: 'Tax filing acknowledgement',
    heading: 'Egyptian Tax Authority',
    contact: 'eta.gov.example · 16395',
    summary:
      'The acknowledgement for the quarterly return, with the reference number and the date the next filing window closes.',
    fields: [
      ['Taxpayer', 'Mina'],
      ['Registration', '441-882-113'],
      ['Period filed', '{PERIOD}'],
      ['Reference', 'ETA-{REF}'],
      ['Next filing closes', '{DUE}'],
    ],
    body: [
      'This acknowledgement confirms receipt of the return only. It is not an',
      'assessment. Retain it with the supporting invoices for five years.',
      'The next return covers the following quarter and closes on the date above.',
    ],
    footer: 'Generated electronically. No signature is required.',
    candidates: [
      {
        title: 'File the quarterly tax return',
        domain: 'finance',
        priority: 'urgent',
        estimate: [90, 120],
        dueOffset: 80,
      },
    ],
    weight: 2,
  },
  {
    id: 'building',
    type: 'letter',
    issuer: 'Building committee',
    documentTitle: 'Building committee notice',
    heading: 'El Merghany 14 — Building Committee',
    contact: 'Posted to all residents',
    summary:
      'A notice to residents about scheduled works and the contribution each flat is asked for.',
    amount: [350, 900],
    fields: [
      ['Flat', '6'],
      ['Contribution', '{AMOUNT}'],
      ['Collection by', '{DUE}'],
    ],
    body: [
      'The lift service contract is being renewed and the stairwell repainted.',
      'Contributions are collected by the doorman against a numbered receipt.',
      'Residents who prefer to transfer may ask the committee for details.',
    ],
    footer: 'Please keep your receipt.',
    candidates: [
      {
        title: 'Pay the building maintenance contribution',
        domain: 'home',
        priority: 'normal',
        estimate: [5, 15],
        dueOffset: 12,
      },
    ],
    weight: 3,
  },
  {
    id: 'passport',
    type: 'identity',
    issuer: 'Passports & Immigration Authority',
    documentTitle: 'Passport renewal slip',
    heading: 'Passports, Immigration and Nationality Authority',
    contact: 'Abbassia office · Cairo',
    summary:
      'The collection slip for a passport renewal, with the reference and the date the new document can be picked up.',
    fields: [
      ['Applicant', 'Mina'],
      ['Application', 'PP-{REF}'],
      ['Lodged', '{ISSUED}'],
      ['Collect from', 'Abbassia — counter 7'],
      ['Ready by', '{DUE}'],
    ],
    body: [
      'Bring this slip and the original national ID to collect. The passport',
      'cannot be released to a third party without a notarised authorisation.',
      'Uncollected documents are returned to central storage after 90 days.',
    ],
    footer: 'Keep this slip. A replacement cannot be issued.',
    candidates: [
      {
        title: 'Collect the renewed passport',
        domain: 'family',
        priority: 'high',
        estimate: [90, 120],
        dueOffset: 30,
      },
    ],
    weight: 1,
  },
]
