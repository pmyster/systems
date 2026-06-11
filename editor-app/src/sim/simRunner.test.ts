/**
 * SimRunner — determinism integration test.
 *
 * This is the load-bearing test for Week 1A's whole architectural claim.
 * If it ever fails, EVERY downstream feature that assumes deterministic
 * sim (replay, lockstep MP, post-mortem analysis) is broken — so this
 * file is also wired as the body of `npm run test:determinism` for
 * fast CI-fail signal.
 *
 * Strategy:
 *   - Build two runners with the same seed.
 *   - Load the same command log into both.
 *   - Drive both with the same wall-clock sequence.
 *   - Draw N random numbers from each runner's PRNG at the end.
 *   - Assert the sequences are bit-identical.
 *
 * Why test the PRNG output instead of world state? Day 1 has no
 * systems → world state is trivially empty. The PRNG is the first
 * thing that would desync when systems start consuming randomness,
 * so guarding it now means the next slice that adds a system gets
 * determinism coverage for free.
 */

import { describe, it, expect } from "vitest";
import { SimRunner } from "./simRunner";
import type { SimCommand } from "./commandBus";

function drive(runner: SimRunner, wallSeq: readonly number[]): void {
  for (const t of wallSeq) runner.advance(t);
}

function drainPrn(runner: SimRunner, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(runner.random.next());
  return out;
}

describe("SimRunner determinism", () => {
  it("two runners with same seed produce identical PRNG streams", () => {
    const a = new SimRunner({ hz: 30, seed: 12345 });
    const b = new SimRunner({ hz: 30, seed: 12345 });
    expect(drainPrn(a, 100)).toEqual(drainPrn(b, 100));
  });

  it("identical commands + identical wall clock → identical state after N ticks", () => {
    const log: SimCommand[] = [
      { tick: 0, playerId: 0, kind: "spawnUnit", payload: { x: 1, y: 0, z: 1 } },
      { tick: 5, playerId: 0, kind: "move",      payload: { x: 10, z: 10 } },
      { tick: 9, playerId: 1, kind: "attack",    payload: { target: 42 } },
    ];
    const wall = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];

    const a = new SimRunner({ hz: 30, seed: 999 });
    const b = new SimRunner({ hz: 30, seed: 999 });
    a.commands.loadFromLog(log);
    b.commands.loadFromLog(log);
    drive(a, wall);
    drive(b, wall);

    expect(a.clock.tickId).toBe(b.clock.tickId);
    expect(a.commands.snapshot()).toEqual(b.commands.snapshot());
    expect(drainPrn(a, 50)).toEqual(drainPrn(b, 50));
  });

  it("different seeds produce different PRNG streams (sanity check)", () => {
    const a = new SimRunner({ hz: 30, seed: 1 });
    const b = new SimRunner({ hz: 30, seed: 2 });
    expect(drainPrn(a, 10)).not.toEqual(drainPrn(b, 10));
  });

  it("advance() returns step counts that match a manual SimClock calculation", () => {
    const r = new SimRunner({ hz: 30, seed: 0 });
    // First call primes (returns 0).
    expect(r.advance(0)).toBe(0);
    // 1/30 of a second → exactly one step.
    expect(r.advance(1 / 30)).toBe(1);
    // 2/30 of a second more → two more steps.
    expect(r.advance(3 / 30)).toBe(2);
    expect(r.clock.tickId).toBe(3);
  });
});
