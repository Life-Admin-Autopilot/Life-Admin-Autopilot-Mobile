// Short-TTL in-memory map of pending destructive tool calls. The chat
// stream yields a tool_call event; this store holds the validated args
// until the user POSTs to /ai/tools/confirm/:callId. Wiscord uses a
// similar in-process map for v1 and migrates to Redis when horizontal.
//
// The map is bounded on BOTH axes so a runaway client (or a model that
// emits a flood of destructive calls) can't grow it without limit:
//   - per-user cap: a single user can't hold more than MAX_PER_USER pending
//     calls; registering past the cap evicts that user's oldest entry (LRU
//     by registration time).
//   - global cap: across all users the map never exceeds MAX_GLOBAL; past
//     the cap the globally-oldest entry is evicted.
// Expired entries (older than TTL_MS) are swept opportunistically on every
// register so dead entries don't count toward either cap.
//
// NOTE: this is best-effort memory hygiene only. The confirm route now
// reconstructs + re-validates from the persisted AiConversation toolCall
// record when this map has been swept or lost (e.g. after a restart), so
// eviction here never strands a "Confirm delete?" turn.

interface PendingCall {
  userId: string
  name: string
  args: Record<string, unknown>
  timezone: string | undefined
  registeredAt: number
}

const PENDING = new Map<string, PendingCall>()
const TTL_MS = 60 * 60 * 1000 // 1h — matches the conversation sweep window

// Caps chosen for a single-process v1: a user juggling more than 25 unconfirmed
// destructive calls is pathological; 5000 total is a generous ceiling that
// still bounds memory if every user piled up at once.
const MAX_PER_USER = 25
const MAX_GLOBAL = 5000

function isExpired(entry: PendingCall, now: number): boolean {
  return now - entry.registeredAt > TTL_MS
}

// Drop every entry past its TTL. Runs on register so the caps below count
// only live entries.
function sweepExpired(now: number): void {
  for (const [id, entry] of PENDING) {
    if (isExpired(entry, now)) PENDING.delete(id)
  }
}

// Evict the oldest entry matching the predicate (LRU by registeredAt).
function evictOldest(predicate: (entry: PendingCall) => boolean): void {
  let oldestId: string | null = null
  let oldestAt = Infinity
  for (const [id, entry] of PENDING) {
    if (!predicate(entry)) continue
    if (entry.registeredAt < oldestAt) {
      oldestAt = entry.registeredAt
      oldestId = id
    }
  }
  if (oldestId !== null) PENDING.delete(oldestId)
}

function countForUser(userId: string): number {
  let n = 0
  for (const entry of PENDING.values()) {
    if (entry.userId === userId) n++
  }
  return n
}

export function registerPendingCall(args: {
  callId: string
  userId: string
  name: string
  args: Record<string, unknown>
  timezone?: string
}): void {
  const now = Date.now()
  sweepExpired(now)

  // Enforce the per-user cap first so one user can't crowd out everyone via
  // the global cap. Evict this user's oldest pending call to make room.
  if (countForUser(args.userId) >= MAX_PER_USER) {
    evictOldest((entry) => entry.userId === args.userId)
  }

  // Then the global cap — evict the globally-oldest live entry.
  if (PENDING.size >= MAX_GLOBAL) {
    evictOldest(() => true)
  }

  PENDING.set(args.callId, {
    userId: args.userId,
    name: args.name,
    args: args.args,
    timezone: args.timezone,
    registeredAt: now,
  })
}

export function consumePendingCall(callId: string): PendingCall | null {
  const entry = PENDING.get(callId)
  if (!entry) return null
  PENDING.delete(callId)
  if (isExpired(entry, Date.now())) return null
  return entry
}

export function peekPendingCall(callId: string): PendingCall | null {
  const entry = PENDING.get(callId)
  if (!entry) return null
  if (isExpired(entry, Date.now())) {
    PENDING.delete(callId)
    return null
  }
  return entry
}

// Test-only helper.
export function __clearPendingCallsForTests(): void {
  PENDING.clear()
}
