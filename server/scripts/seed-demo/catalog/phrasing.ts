// Language banks for the surfaces that show prose rather than a matter title:
// voice transcripts, the questions Kitto holds back to ask, the chat thread,
// and the one-line summaries on scanned documents.

/** How someone actually talks into a phone while walking out of a building. */
export const VOICE_TRANSCRIPTS: string[] = [
  'Remind me to pay the electricity bill before the twelfth, the slip is on the fridge.',
  'I need to call the plumber about the leak under the sink, ideally tomorrow morning.',
  'Book Basbousa in for her booster, the clinic said sometime this month is fine.',
  'Don’t let me forget the school fees instalment, it’s due the eleventh I think.',
  'Pick up the blood test results on the way back from work, and send them to Dr Yassin.',
  'The car is making that rattling noise again — get it looked at before the long drive.',
  'Buy a present for Mum, her birthday is the week after next.',
  'Cancel the streaming subscription, we haven’t opened it in three months.',
  'Chase the refund from the airline, it’s been six weeks now.',
  'Renew the internet plan, and check whether the faster package is actually cheaper.',
  'I have to send the invoice to the agency today, they close the month on Thursday.',
  'Get the air conditioner serviced before the summer properly starts.',
  'Remind me to fast from midnight, the blood work is at eight.',
  'Order the flea treatment, we’re nearly out.',
  'The tyres feel soft, check the pressure at the weekend.',
  'Sign Nour’s trip form and put it back in her bag tonight.',
  'Move the savings across before the end of the month, don’t leave it in the current account.',
  'Ask the vet why she’s off her food, it’s been a couple of days.',
  'Book the dentist, it’s been more than six months and I keep putting it off.',
  'Renew the car licence, the sticker expires next month and there’s a queue.',
  'Pay the maintenance fee, the committee left a note.',
  'Replace the wiper blades before it rains again.',
  'Call the school about the parent-teacher meeting time, the email was ambiguous.',
  'Take the mattress protector out of the delivery box and actually put it on.',
]

/** Transcripts deliberately ambiguous enough to be held for review. */
export const MESSY_TRANSCRIPTS: string[] = [
  'Remind me about the thing with the bank, either Tuesday or Thursday, I’ll know by then.',
  'Email that guy back about the quote — the one from last week.',
  'Sort out the car thing before it becomes a problem.',
  'Book the appointment, maybe the fifteenth, or the week after if they’re full.',
  'I need to deal with the insurance, it renews soon-ish.',
  'Pay the bill — not the electricity one, the other one.',
]

// `said` is what the user asked for in their own words — the card quotes it back
// so a question opened days later is answerable without remembering the request.
// Each one has to genuinely PRODUCE its question: a quote that doesn't explain
// why Kitto asked makes the seeded stack read as noise.
export const CLARIFY_QUESTIONS: {
  question: string
  kind: 'date' | 'detail' | 'choice'
  options: string[]
  said: string
}[] = [
  {
    question: 'You said Tuesday or Thursday — which one should I hold?',
    kind: 'date',
    options: ['Tuesday', 'Thursday'],
    said: 'Remind me about the thing with the bank, either Tuesday or Thursday, I’ll know by then.',
  },
  {
    question: 'Which bill did you mean?',
    kind: 'choice',
    options: ['Water', 'Gas', 'Internet'],
    said: 'Pay the bill — not the electricity one, the other one.',
  },
  {
    question: 'What should I call this one?',
    kind: 'detail',
    options: [],
    said: 'Email that guy back about the quote — the one from last week.',
  },
  {
    question: '“Soon-ish” — is that this month or next?',
    kind: 'date',
    options: ['This month', 'Next month'],
    said: 'I need to deal with the insurance, it renews soon-ish.',
  },
  {
    question: 'Morning or evening appointment?',
    kind: 'choice',
    options: ['Morning', 'Evening'],
    said: 'Book the appointment, maybe the fifteenth, or the week after if they’re full.',
  },
  {
    question: 'Is this the same quote you asked about last week, or a new one?',
    kind: 'choice',
    options: ['Same one', 'New one'],
    said: 'Chase up the quote for the balcony sealing, they still haven’t sent it.',
  },
  {
    question: 'Should I put a deadline on this, or leave it on the list?',
    kind: 'choice',
    options: ['Give it a deadline', 'Leave it on the list'],
    said: 'Sort out the car thing before it becomes a problem.',
  },
]

/** What the user types into the chat island. */
export const CHAT_USER_TURNS: string[] = [
  'what’s on today?',
  'remind me to pay the water bill on the 18th',
  'did I already pay the electricity this month?',
  'move the dentist to next week',
  'what’s overdue?',
  'add buy cat litter to the list',
  'how much have I got due this week?',
  'anything for the car coming up?',
  'clear everything I finished yesterday',
  'when is the car licence due?',
  'remind me about mum’s birthday two weeks before',
  'what did I scan last week?',
  'push the balcony cleaning to next month',
  'show me anything about school',
  'is the insurance renewal sorted?',
  'add a step to the tax return: check last year’s figures',
  'what’s the busiest day this week?',
  'snooze the eye test for a month',
  'anything I’ve been putting off?',
  'summarise the last month for me',
]

export const CHAT_ASSISTANT_TURNS: string[] = [
  'Six matters due today. The credit card statement is the one with a deadline attached — the rest can move.',
  'Added. I’ll nudge you five days before, the way I do with the other bills.',
  'Yes — you closed it on the 11th, a day early.',
  'Moved to next Tuesday. The clinic’s original date is still in the notes if you need it.',
  'Four things are past their date. Two of them have moved three times now.',
  'On the list. No deadline, so it won’t nudge you.',
  'About 34,000 EGP across nine matters, most of it the school fees instalment.',
  'The licence renewal is in three weeks, and the tyres are due a check.',
  'Cleared eleven. You can undo that from the toast if I got it wrong.',
  'The 13th of next month. I’ll start reminding you two months out — it’s the one with the queue.',
  'Set. You’ll hear from me on the 4th.',
  'Three: an electricity bill, the vet statement, and the school enrolment form.',
  'Pushed to the 24th. That was its second move.',
  'Nine matters mention school. Four are still open.',
  'Renewed on the 2nd, and the certificate is filed against the scan.',
  'Added the step. Three of four are still open on that one.',
  'Thursday — five things land on it. Want me to spread them out?',
  'Snoozed until the 28th. Its real date hasn’t moved.',
  'Two have been sitting there since spring. Neither has a deadline, which is probably why.',
  'You closed 38 matters last month and opened 41. The heaviest week was the one with the tax return in it.',
]

/** One-line document summaries, paired with the doc templates in documents.ts. */
export const DOCUMENT_NOTES: string[] = [
  'Keep for the tax file.',
  'Filed. Nothing else needed on this one.',
  'Reference number is on the second page.',
  'Scanned the day it arrived.',
  'The amount is different from last month — worth a look.',
]

/** Notes attached to ordinary matters, for texture on the detail sheet. */
export const TASK_NOTES: string[] = [
  'The reference number is in the photo on my phone.',
  'They said to call before going, the queue is shorter after 2pm.',
  'Cheaper if paid online rather than at the branch.',
  'Last time this took twice as long as I expected.',
  'Ask about the family discount while I’m there.',
  'Bring the old one with me, they need it back.',
  'Do this before the end of the month or the price changes.',
  'The paperwork is in the blue folder.',
]
