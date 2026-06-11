/**
 * SimRandom — determinism tests.
 *
 * Golden values guard the algorithm itself. If anyone "optimizes"
 * `next()` and changes the byte-for-byte output, this test screams.
 * The whole reason we use mulberry32 is reproducibility, so a drift
 * here is a regression, not an improvement.
 */

import { describe, it, expect } from "vitest";
import { SimRandom } from "./random";

describe("SimRandom", () => {
  it("produces identical sequences for the same seed", () => {
    const a = new SimRandom(42);
    const b = new SimRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("produces different sequences for different seeds", () => {
    const a = new SimRandom(1);
    const b = new SimRandom(2);
    // Not strictly required by the algorithm, but a regression here
    // would mean a seed-collision bug — worth catching.
    const first5a = Array.from({ length: 5 }, () => a.next());
    const first5b = Array.from({ length: 5 }, () => b.next());
    expect(first5a).not.toEqual(first5b);
  });

  it("snapshot matches inline reference computation (algorithm anchor)", () => {
    // This reference implementation is a verbatim copy of mulberry32 to
    // catch the case where someone swaps the algorithm under us. It is
    // intentionally NOT a hardcoded byte-for-byte golden — those drift
    // silently when JS numeric output changes across runtimes. Instead
    // we recompute and require bit-equality with the in-class version.
    function refMulberry32(seedIn: number): () => number {
      let state = seedIn >>> 0;
      return () => {
        let t = (state += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const ref = refMulberry32(12345);
    const rng = new SimRandom(12345);
    for (let i = 0; i < 50; i++) {
      expect(rng.next()).toBe(ref());
    }
  });

  it("range() returns values inside [min, max)", () => {
    const rng = new SimRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it("intRange() returns integers in [min, max] inclusive", () => {
    const rng = new SimRandom(7);
    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < 5000; i++) {
      const v = rng.intRange(0, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(3);
      if (v === 0) sawMin = true;
      if (v === 3) sawMax = true;
    }
    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });

  it("pick() returns an element from the array", () => {
    const rng = new SimRandom(99);
    const arr = ["a", "b", "c", "d"] as const;
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });

  it("normalizes negative seeds to uint32", () => {
    // `-1 >>> 0 === 0xFFFFFFFF`. Two runners — one with -1, one with
    // 0xFFFFFFFF — must agree.
    const a = new SimRandom(-1);
    const b = new SimRandom(0xffffffff);
    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBe(b.next());
    }
  });
});
