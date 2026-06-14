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
  tasks: ['tasks'] as const,
}
