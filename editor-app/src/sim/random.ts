/**
 * Seeded PRNG — the ONLY legal source of randomness inside `/sim`.
 *
 * Why: determinism. Two SimRunners constructed with the same seed must
 * produce identical RNG streams, which is what lets replay logs reproduce
 * a match exactly and lets lockstep multiplayer stay in sync.
 *
 * Algorithm: mulberry32. 32-bit state, ~4 GiB period, ~uniform output.
 * Not cryptographic — purely deterministic. Banned globals (Math.random,
 * Date.now, performance.now) must never appear in this module; the purity
 * check in scripts/check-sim-purity.mts will fail the build otherwise.
 *
 * Reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */

export class SimRandom {
  /** 32-bit unsigned state. Coerced via `>>> 0` to stay in uint32 range. */
  private state: number;

  constructor(seed: number) {
    // `>>> 0` forces uint32 — guards against negative or float seeds drifting
    // the stream silently.
    this.state = seed >>> 0;
  }

  /** Returns a number in [0, 1). Uniform distribution, double precision output. */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a number in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns an integer in [min, max] inclusive on both ends. */
  intRange(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Picks a uniformly random element from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.intRange(0, arr.length - 1)];
  }
}
