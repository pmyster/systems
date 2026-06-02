/**
 * SimClock — fixed-timestep accumulator tests.
 *
 * Strategy: feed hand-rolled wall-clock sequences and count `onStep`
 * invocations. Since the clock never calls a global time source itself,
 * we get full determinism in tests for free.
 */

import { describe, it, expect, vi } from "vitest";
import { SimClock } from "./clock";

describe("SimClock", () => {
  it("first tick seeds lastWallSec and does NOT step", () => {
    const clock = new SimClock({ hz: 30 });
    const onStep = vi.fn();
    const steps = clock.tick(0, onStep);
    expect(steps).toBe(0);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("advances one step when frame delta equals stepSec", () => {
    const clock = new SimClock({ hz: 30 });
    const onStep = vi.fn();
    clock.tick(0, onStep);              // prime
    const steps = clock.tick(1 / 30, onStep);
    expect(steps).toBe(1);
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledWith(0, 1 / 30);
  });

  it("runs N steps over N stepSec worth of wall time", () => {
    const clock = new SimClock({ hz: 30 });
    const onStep = vi.fn();
    clock.tick(0, onStep);
    // 1 second of wall time at 30 Hz → 30 steps owed; but maxStepsPerFrame
    // defaults to 5, so we walk forward frame-by-frame at 1/30 to avoid
    // the cap.
    let t = 0;
    let total = 0;
    for (let i = 0; i < 10; i++) {
      t += 1 / 30;
      total += clock.tick(t, onStep);
    }
    expect(total).toBe(10);
    expect(onStep).toHaveBeenCalledTimes(10);
    // Tick ids must be monotonic 0..9.
    for (let i = 0; i < 10; i++) {
      expect(onStep.mock.calls[i][0]).toBe(i);
    }
  });

  it("maxStepsPerFrame caps spiral-of-death", () => {
    const clock = new SimClock({ hz: 30, maxStepsPerFrame: 3 });
    const onStep = vi.fn();
    clock.tick(0, onStep);
    // Big jump that "owes" 6 steps but the cap is 3.
    const steps = clock.tick(0.2, onStep);  // 0.2s = 6 ticks at 30Hz
    expect(steps).toBe(3);
    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it("clamps a tab-pause jump to <= 0.25 s of accumulated time", () => {
    const clock = new SimClock({ hz: 30, maxStepsPerFrame: 1000 });
    const onStep = vi.fn();
    clock.tick(0, onStep);
    // Simulate a 10-second tab pause. Without the 0.25s clamp this would
    // run ~300 steps; with the clamp it runs floor(0.25 / (1/30)) = 7.
    const steps = clock.tick(10, onStep);
    expect(steps).toBe(7);
  });

  it("getAlpha reflects partial-step progress", () => {
    const clock = new SimClock({ hz: 30 });
    const onStep = vi.fn();
    clock.tick(0, onStep);
    // Half a step's worth of time.
    clock.tick(1 / 60, onStep);
    expect(onStep).not.toHaveBeenCalled();    // not enough for a step
    expect(clock.getAlpha()).toBeCloseTo(0.5, 5);
  });

  it("reset() clears all state", () => {
    const clock = new SimClock({ hz: 30 });
    const onStep = vi.fn();
    clock.tick(0, onStep);
    clock.tick(1, onStep);                    // many steps
    expect(clock.tickId).toBeGreaterThan(0);
    clock.reset();
    expect(clock.tickId).toBe(0);
    expect(clock.getAlpha()).toBe(0);
    // After reset, the next tick should behave like a first-call prime.
    const steps = clock.tick(0, onStep);
    expect(steps).toBe(0);
  });

  it("identical wall-clock sequences produce identical step counts", () => {
    const seq = [0, 0.05, 0.10, 0.16, 0.17, 0.22, 0.50];
    const recordStepsFor = (): number[] => {
      const c = new SimClock({ hz: 30 });
      const out: number[] = [];
      for (const t of seq) out.push(c.tick(t, () => {}));
      return out;
    };
    expect(recordStepsFor()).toEqual(recordStepsFor());
  });
});
