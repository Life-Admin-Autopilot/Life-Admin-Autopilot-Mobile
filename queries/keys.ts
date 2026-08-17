// Query keys — single source so caches reconcile (AGENTS.md → Data access).
export const queryKeys = {
  me: ['me'] as const,
  health: ['health'] as const,
  ai: {
    /** Every thread, for the history drawer. */
    threads: () => ['ai', 'threads'] as const,
    /** One thread's transcript. Keyed by id so switching threads is a cache
     *  read, not a refetch of whatever the last thread happened to be. */
    thread: (id: string) => ['ai', 'thread', id] as const,
    quota: () => ['ai', 'quota'] as const,
  },
  notifications: ['notifications'] as const,
  clarifications: ['clarifications'] as const,
  /** Status of specific rows, by id — see useClarificationStatuses. */
  clarificationStatuses: (ids: readonly string[]) =>
    ['clarifications', 'by-ids', [...ids].sort().join(',')] as const,
  /** The Knowledge Agent's daily briefing. */
  briefing: () => ['briefing', 'today'] as const,
  /** Conflicts re-checked for one saved task. */
  taskConflicts: (id: string) => ['tasks', 'conflicts', id] as const,
  /** Every task's conflicts. A clash is symmetric, so moving one matter changes
   *  the answer for the matter it was clashing WITH, not just for itself. */
  taskConflictsAll: ['tasks', 'conflicts'] as const,
  // A factory, not a flat key: the Matters list caches per filter set, so the
  // list needs its own namespace while `all` stays the blunt invalidation
  // handle every task mutation reaches for.
  tasks: {
    all: ['tasks'] as const,
    list: (filters: unknown) => ['tasks', 'list', filters] as const,
    counts: () => ['tasks', 'counts'] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
    tags: () => ['tasks', 'tags'] as const,
    trash: () => ['tasks', 'trash'] as const,
    // The one open categorize proposal. Its own key because it survives a
    // reload — a proposal the user walked away from is still waiting when
    // they come back, and the sheet reopens from this rather than from state.
    categorizePending: () => ['tasks', 'categorize', 'pending'] as const,
  },
  // Subscribed calendar feeds. Separate from `tasks` even though a sync writes
  // matters — the feed list carries its own health (last synced, last error),
  // and a sync has to invalidate BOTH namespaces.
  icsFeeds: ['icsFeeds'] as const,
  // The connected Google account. Separate from icsFeeds — both write matters,
  // but their connection state and health are unrelated.
  googleIntegration: ['integrations', 'google'] as const,
  documentScans: ['documentScans'] as const,
  // Nested under the scans namespace but a separate key: the quota changes on
  // upload while the list changes on upload AND on delete, so sharing one key
  // would refetch the whole list every time a meter ticked.
  documentScanQuota: ['documentScans', 'quota'] as const,
  // The money summary, keyed by window: 3, 6 and 12 months are three different
  // answers, and switching between them should read from cache rather than
  // refetch whichever one happened to be last.
  financeSummary: (months: number) => ['finance', 'summary', months] as const,
  // Account surfaces. `sessions` is the signed-in-devices list; it invalidates
  // on password change and on revoke, both of which end sessions server-side.
  sessions: ['sessions'] as const,
  subscription: ['subscription'] as const,
  invoices: ['billing', 'invoices'] as const,
  // Keyed by IANA zone: the digest describes a local calendar day, so the same
  // user in a different zone is a different digest, not a stale one.
  digest: (tz: string) => ['digest', tz] as const,
  // The blunt invalidation handle, mirroring `tasks.all`. Mutations don't know
  // the caller's zone and shouldn't have to — the dashboard's counts (including
  // the "Needs you" strip) come from the digest, so anything that changes a
  // count has to reach every cached zone, not just one.
  digestAll: ['digest'] as const,
}
