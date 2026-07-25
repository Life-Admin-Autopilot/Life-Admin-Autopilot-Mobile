// Query keys — single source so caches reconcile (AGENTS.md → Data access).
export const queryKeys = {
  me: ['me'] as const,
  health: ['health'] as const,
  ai: {
    conversation: () => ['ai', 'conversation'] as const,
    quota: () => ['ai', 'quota'] as const,
  },
  notifications: ['notifications'] as const,
  clarifications: ['clarifications'] as const,
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
  },
  documentScans: ['documentScans'] as const,
}
