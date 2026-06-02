/**
 * /sim — Top-level orchestrator.
 *
 * Owns the four foundational pieces:
 *   - `world`     — bitECS world (entity allocator + components)
 *   - `random`    — seeded PRNG (only legal randomness source)
 *   - `commands`  — append-only player input log
 *   - `clock`     — fixed-timestep accumulator
 *
 * A renderer (or a test, or a Worker) calls `advance(wallClockSec)`
 * once per frame; the runner does the rest.
 *
 * Determinism contract: two SimRunners constructed with the same
 * `{hz, seed}` and fed the same command log will produce identical
 * world state at every tick. The integration test in
 * `simRunner.test.ts` is the standing proof. Any future PR that
 * breaks this contract MUST update the test in the same commit so
 * the failure is loud, not silent.
 *
 * Day 1: no systems run inside `simStep`. The skeleton is in place so
 * that adding `movementSystem(world, dtSec)` later is a one-line edit
 * and the whole sim/render/replay machinery picks it up for free.
 */

import { SimClock } from "./clock";
import { CommandBus } from "./commandBus";
import { createSimWorld, type SimWorld } from "./world";
import { SimRandom } from "./random";
import { applyCommands } from "./systems/commandApplySystem";
import { movementSystem } from "./systems/movementSystem";

export interface SimRunnerOpts {
  /** Fixed sim rate. Project-wide = 30. */
  readonly hz: number;
  /** PRNG seed. Same seed + same commands = identical outcome. */
  readonly seed: number;
}

export class SimRunner {
  readonly world: SimWorld;
  readonly random: SimRandom;
  readonly commands: CommandBus;
  readonly clock: SimClock;

  constructor(opts: SimRunnerOpts) {
    this.world = createSimWorld();
    this.random = new SimRandom(opts.seed);
    this.commands = new CommandBus();
    this.clock = new SimClock({ hz: opts.hz });
  }

  /**
   * Drive the sim. Called once per animation frame with wall-clock
   * seconds. Returns the number of sim steps that ran this frame
   * (useful for the HUD's "steps/frame" readout).
   */
  advance(wallClockSec: number): number {
    return this.clock.tick(wallClockSec, (tickId, dtSec) => {
      this.simStep(tickId, dtSec);
    });
  }

  /**
   * One sim tick.
   *
   * Systems run in a FIXED ORDER. Order is part of the determinism
   * contract — re-ordering systems is equivalent to changing physics.
   * Future systems register here, e.g.:
   *
   *   inputCommandSystem(this.world, _cmds);
   *   movementSystem(this.world, dtSec);
   *   physicsSystem(this.world, dtSec);
   *   combatSystem(this.world, dtSec, this.random);
   *
   * For Day 1 the body is intentionally empty — the architecture is
   * what we're proving, not behavior.
   */
  private simStep(tickId: number, dtSec: number): void {
    // 1. Inputs first. Commands queued by the UI at this tick land in
    //    the world (MovementTarget writes, etc.) before any system
    //    that consumes them runs.
    const cmds = this.commands.forTick(tickId);
    applyCommands(this.world, cmds);

    // 2. Movement. Walks each entity toward its current MovementTarget
    //    at MovementSpeed * dtSec; clears hasTarget on arrival so the
    //    render-side PathFollowController can queue the next waypoint.
    movementSystem(this.world, dtSec);

    // 3. (Combat / AI / projectiles / hit feedback land in Week 3.)
  }
}
