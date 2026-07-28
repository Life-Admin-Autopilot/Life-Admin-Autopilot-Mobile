import type { Domain } from '../../../src/models/User'
import type { TaskKind, TaskPriority } from '../../../src/models/Task'

// One-off matters — the 60% of a real backlog that isn't a standing commitment.
//
// Titles carry a `{}` slot filled from `variants`, so three years of "book an
// appointment" don't collapse into three years of the SAME string. Exact
// repetition matters: findDuplicates() bins on the normalised title, so a
// template with no variation would make the digest cry duplicate at ordinary
// life.

export interface OneOffTemplate {
  title: string
  domain: Domain
  /** Fills the `{}` slot in `title`. */
  variants?: string[]
  priority?: TaskPriority
  kind?: TaskKind
  estimate: [number, number]
  tags: string[]
  /** Chance this one carries steps. */
  subtasks?: string[]
  note?: string
  /** Relative frequency against the other templates. */
  weight?: number
}

export const ONE_OFFS: OneOffTemplate[] = [
  // ---- health ----
  {
    title: 'Book a {} appointment',
    domain: 'health',
    variants: ['dermatology', 'physiotherapy', 'GP', 'ENT', 'orthopaedic', 'nutritionist'],
    estimate: [10, 15],
    tags: ['appointment'],
    weight: 3,
  },
  {
    title: 'Pick up the {} results',
    domain: 'health',
    variants: ['x-ray', 'blood test', 'ultrasound', 'MRI'],
    estimate: [30, 45],
    tags: ['results'],
  },
  {
    title: 'Renew the health insurance card',
    domain: 'health',
    priority: 'high',
    estimate: [45, 60],
    tags: ['insurance'],
  },
  {
    title: 'Order a new pair of {}',
    domain: 'health',
    variants: ['glasses', 'contact lenses', 'orthotic insoles'],
    estimate: [30, 45],
    tags: ['order'],
  },
  {
    title: 'Start the {} course of physio exercises',
    domain: 'health',
    variants: ['back', 'shoulder', 'knee'],
    kind: 'list',
    priority: 'low',
    estimate: [15, 30],
    tags: ['physio'],
  },
  {
    title: 'Book the flu shot',
    domain: 'health',
    estimate: [15, 30],
    tags: ['vaccination'],
  },

  // ---- home ----
  {
    title: 'Fix the {} in the kitchen',
    domain: 'home',
    variants: ['leaking tap', 'broken cabinet hinge', 'extractor fan', 'blocked drain'],
    estimate: [45, 90],
    tags: ['repair'],
    weight: 2,
  },
  {
    title: 'Call the plumber about the {}',
    domain: 'home',
    variants: ['bathroom leak', 'water heater', 'pressure drop', 'kitchen sink'],
    priority: 'high',
    estimate: [10, 15],
    tags: ['repair', 'plumber'],
  },
  {
    title: 'Replace the {} bulbs',
    domain: 'home',
    variants: ['hallway', 'balcony', 'bedroom', 'stairwell'],
    priority: 'low',
    kind: 'list',
    estimate: [15, 30],
    tags: ['maintenance'],
  },
  {
    title: 'Order a replacement {}',
    domain: 'home',
    variants: ['shower head', 'door handle', 'curtain rail', 'mattress protector', 'air filter'],
    estimate: [15, 30],
    tags: ['order'],
    weight: 2,
  },
  {
    title: 'Sort out the {} cupboard',
    domain: 'home',
    variants: ['linen', 'kitchen', 'medicine', 'shoe'],
    priority: 'low',
    kind: 'list',
    estimate: [60, 90],
    tags: ['tidying'],
  },
  {
    title: 'Get a quote for {}',
    domain: 'home',
    variants: ['repainting the living room', 'new blinds', 'sealing the balcony', 'kitchen worktop'],
    estimate: [30, 45],
    tags: ['quote'],
  },
  {
    title: 'Refill the fire extinguisher',
    domain: 'home',
    estimate: [30, 45],
    tags: ['safety'],
  },

  // ---- car ----
  {
    title: 'Pay the {} traffic fine',
    domain: 'car',
    variants: ['speeding', 'parking', 'red light'],
    priority: 'high',
    estimate: [15, 30],
    tags: ['fine'],
  },
  {
    title: 'Replace the {}',
    domain: 'car',
    variants: ['wiper blades', 'car battery', 'brake pads', 'cabin filter', 'headlight bulb'],
    estimate: [45, 90],
    tags: ['car', 'parts'],
    weight: 2,
  },
  {
    title: 'Book the car in for the {} noise',
    domain: 'car',
    variants: ['rattling', 'squealing', 'knocking'],
    estimate: [10, 15],
    tags: ['car', 'repair'],
  },
  {
    title: 'Wash and vacuum the car',
    domain: 'car',
    priority: 'low',
    kind: 'list',
    estimate: [45, 60],
    tags: ['car'],
  },
  {
    title: 'Renew the parking permit',
    domain: 'car',
    estimate: [30, 45],
    tags: ['car', 'permit'],
  },

  // ---- finance ----
  {
    title: 'Chase the refund from {}',
    domain: 'finance',
    variants: ['Amazon', 'the airline', 'the clinic', 'the letting agent'],
    priority: 'high',
    estimate: [15, 30],
    tags: ['refund'],
    weight: 2,
  },
  {
    title: 'Cancel the {} subscription',
    domain: 'finance',
    variants: ['streaming', 'cloud storage', 'gym', 'newsletter', 'design tool'],
    estimate: [10, 15],
    tags: ['subscription'],
    weight: 2,
  },
  {
    title: 'Update the card details on {}',
    domain: 'finance',
    variants: ['the hosting account', 'the streaming account', 'the app store', 'the courier account'],
    estimate: [5, 15],
    tags: ['cards'],
  },
  {
    title: 'Send the invoice to {}',
    domain: 'finance',
    variants: ['the agency', 'the studio', 'the client in Dubai', 'the startup'],
    priority: 'high',
    estimate: [15, 30],
    tags: ['invoice', 'work'],
    weight: 3,
  },
  {
    title: 'Reconcile last month’s expenses',
    domain: 'finance',
    estimate: [60, 90],
    tags: ['accounting'],
    subtasks: ['Download the statements', 'Categorise everything', 'Flag anything odd'],
  },
  {
    title: 'Review the {} statement',
    domain: 'finance',
    variants: ['pension', 'brokerage', 'savings', 'certificate'],
    priority: 'low',
    kind: 'list',
    estimate: [30, 45],
    tags: ['review'],
  },
  {
    title: 'Compare {} providers before renewing',
    domain: 'finance',
    variants: ['internet', 'insurance', 'mobile', 'electricity'],
    priority: 'low',
    kind: 'list',
    estimate: [45, 60],
    tags: ['research'],
  },

  // ---- family ----
  {
    title: 'Buy a birthday present for {}',
    domain: 'family',
    variants: ['Mum', 'Dad', 'Nour', 'Youssef', 'Aunt Hoda', 'Kareem'],
    priority: 'high',
    estimate: [45, 60],
    tags: ['gift', 'birthday'],
    weight: 3,
  },
  {
    title: 'Sign and return the {} form',
    domain: 'family',
    variants: ['school trip', 'enrolment', 'medical consent', 'club membership'],
    priority: 'high',
    estimate: [15, 30],
    tags: ['school', 'forms'],
    weight: 2,
  },
  {
    title: 'Book the {} tickets',
    domain: 'family',
    variants: ['Eid holiday', 'North Coast', 'Alexandria', 'Hurghada', 'Luxor'],
    estimate: [45, 60],
    tags: ['travel'],
  },
  {
    title: 'Arrange a visit to {}',
    domain: 'family',
    variants: ['Grandma', 'the cousins', 'Mum and Dad', 'Uncle Adel'],
    priority: 'low',
    kind: 'list',
    estimate: [15, 30],
    tags: ['family'],
  },
  {
    title: 'Renew {}’s passport',
    domain: 'family',
    variants: ['Nour', 'Youssef', 'my'],
    priority: 'urgent',
    estimate: [180, 240],
    tags: ['passport', 'documents'],
    subtasks: ['Get the photos taken', 'Fill in the form', 'Book the appointment', 'Collect it'],
  },
  {
    title: 'Help Nour with the {} project',
    domain: 'family',
    variants: ['science', 'history', 'geography', 'art'],
    priority: 'normal',
    kind: 'list',
    estimate: [60, 90],
    tags: ['school'],
  },

  // ---- pets ----
  {
    title: 'Book Basbousa in for a {}',
    domain: 'pets',
    variants: ['nail trim', 'grooming session', 'dental check', 'weight check'],
    estimate: [15, 30],
    tags: ['basbousa'],
    weight: 2,
  },
  {
    title: 'Order the {} from the pet shop',
    domain: 'pets',
    variants: ['scratching post', 'new carrier', 'flea treatment', 'water fountain filter'],
    estimate: [15, 30],
    tags: ['basbousa', 'order'],
  },
  {
    title: 'Ask the vet about {}',
    domain: 'pets',
    variants: ['her appetite', 'the limping', 'the new food', 'her coat'],
    priority: 'high',
    estimate: [10, 15],
    tags: ['basbousa', 'vet'],
  },
  {
    title: 'Find a cat sitter for the trip',
    domain: 'pets',
    priority: 'high',
    estimate: [30, 45],
    tags: ['basbousa', 'travel'],
  },
]
