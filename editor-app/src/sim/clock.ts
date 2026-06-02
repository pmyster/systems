/**
 * /sim — Fixed-timestep accumulator (Glenn Fiedler "Fix Your Timestep").
 *
 * The sim runs at exactly `hz` ticks per second. The renderer runs at
 * v-sync (variable). The accumulator absorbs the discrepancy:
 *
 *   - Each animation frame we hand the clock the current wall-clock
 *     time (seconds, monotonic — `performance.now()/1000` at the call
 *     site, NOT inside this module).
 *   - The clock figures out how many fixed-size sim steps "owe" since
 *     last frame and runs `onStep` exactly that many times.
 *   - Leftover sub-step time stays in the accumulator and surfaces as
 *     `getAlpha()` — the render layer uses it to interpolate between
 *     last-tick and next-tick state for smooth visuals on a 30 Hz sim.
 *
 * Safeguards:
 *   - `frameDt` is clamped to 250 ms so a tab-pause-then-resume doesn't
 *     trigger thousands of catch-up ticks ("spiral of death").
 *   - `maxStepsPerFrame` is a second-line clamp: even if frameDt looked
 *     fine, we never run more than N steps in a single frame.
 *
 * IMPORTANT: this class is *time-aware* but not *time-sourcing*. It
 * never calls `performance.now()` or `Date.now()` itself — the caller
 * (the runtime view, not /sim) supplies wall-clock seconds, which keeps
 * the sim deterministic and headless-testable.
 */

export interface SimClockOpts {
  /** Sim tick rate. Locked at 30 for this project. */
  readonly hz: number;
  /** Cap on `onStep` invocations per `tick()` call. Default 5. */
  readonly maxStepsPerFrame?: number;
}

export class SimClock {
  /** Time owed but not yet stepped, in seconds. */
  private accumulator = 0;
  /** Fixed step duration, seconds. */
  private readonly stepSec: number;
  /** Per-frame step cap, see class doc. */
  private readonly maxSteps: number;
  /** Last wall-clock time the caller handed us. `null` before first call. */
  private lastWallSec: number | null = null;
  /** Monotonic tick counter — handed to `onStep` and exposed via `tickId`. */
  private currentTickId = 0;

  constructor(opts: SimClockOpts) {
    this.stepSec = 1 / opts.hz;
    this.maxSteps = opts.maxStepsPerFrame ?? 5;
  }

  /**
   * Advance the clock. Returns how many sim steps actually executed.
   *
   * First call seeds `lastWallSec` and returns 0 — there is no prior
   * reference to compute a delta from.
   */
  tick(
    wallClockSec: number,
    onStep: (tickId: number, dtSec: number) => void,
  ): number {
    if (this.lastWallSec === null) {
      this.lastWallSec = wallClockSec;
      return 0;
    }
    // Clamp frameDt to 250 ms — see "spiral of death" note in class doc.
    const frameDt = Math.min(wallClockSec - this.lastWallSec, 0.25);
    this.lastWallSec = wallClockSec;
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= this.stepSec && steps < this.maxSteps) {
      onStep(this.currentTickId, this.stepSec);
      this.currentTickId++;
      this.accumulator -= this.stepSec;
      steps++;
    }
    return steps;
  }

  /**
   * Render interpolation alpha, in [0, 1).
   *
   * 0 = view should show the just-finished tick exactly.
   * Approaching 1 = view should extrapolate toward the upcoming tick.
   * Renderers typically do `lerp(prev, current, alpha)`.
   */
  getAlpha(): number {
    return this.accumulator / this.stepSec;
  }

  /** Hard reset — match restart, or test setup. */
  reset(): void {
    this.accumulator = 0;
    this.lastWallSec = null;
    this.currentTickId = 0;
  }

  /** Read-only view of the tick that will be passed to the NEXT `onStep`. */
  get tickId(): number {
    return this.currentTickId;
  }
}
