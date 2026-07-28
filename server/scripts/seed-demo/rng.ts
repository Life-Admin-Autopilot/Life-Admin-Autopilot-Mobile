// A seeded PRNG, so the same --seed always produces the same dataset.
//
// Math.random() would make every run a different app, which is exactly wrong
// for a dataset people are going to study screenshots of and argue about. With
// this, "the electricity bill on row 3" is the same electricity bill tomorrow.

export class Rng {
  private state: number

  constructor(seed: number) {
    // Any non-zero 32-bit state works; mulberry32 is fine for fixtures and is
    // four lines, which beats pulling a dependency in for fake bill amounts.
    this.state = seed >>> 0 || 1
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Inclusive on both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('rng.pick: empty list')
    return items[Math.floor(this.next() * items.length)] as T
  }

  /** Pick by relative weight. Weights need not sum to anything in particular. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + w, 0)
    let roll = this.next() * total
    for (const [value, weight] of entries) {
      roll -= weight
      if (roll <= 0) return value
    }
    return entries[entries.length - 1]![0]
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1))
      ;[out[i], out[j]] = [out[j] as T, out[i] as T]
    }
    return out
  }

  /** `n` distinct items, or the whole list if it's shorter. */
  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffle(items).slice(0, Math.min(n, items.length))
  }
}
