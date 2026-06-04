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
import { SimEventLog } from "./events";
import { applyCommands } from "./systems/commandApplySystem";
import { movementSystem } from "./systems/movementSystem";
import { stanceSystem } from "./systems/stanceSystem";
import { targetAcquisitionSystem } from "./systems/targetAcquisitionSystem";
import {
  weaponFireSystem,
  type MuzzleResolver,
  type ProjectileLookup,
  type PendingProjectileSpawn,
} from "./systems/weaponFireSystem";
import { projectileSpawnSystem } from "./systems/projectileSpawnSystem";
import {
  projectileSystem,
  type ImpactEvent,
} from "./systems/projectileSystem";
import {
  impactSystem,
  type ZoneArmorLookup,
} from "./systems/impactSystem";
import { deathSystem } from "./systems/deathSystem";
import { bunkerHealSystem } from "./systems/bunkerHealSystem";

export interface SimRunnerOpts {
  /** Fixed sim rate. Project-wide = 30. */
  readonly hz: number;
  /** PRNG seed. Same seed + same commands = identical outcome. */
  readonly seed: number;
}

/**
 * Combat callbacks. The sim is registry-agnostic — it doesn't import
 * ProjectileRegistry or UnitTypeRegistry, just receives callbacks that
 * the runtime layer wires up after MatchLoader produces them.
 *
 * NULL combat bindings: if `combat` is undefined the sim runs without
 * combat systems (Phase 1 Week 2 behaviour). Tests construct the
 * runner with combat bindings; the Week 3 GameRuntime always provides
 * them.
 */
export interface CombatBindings {
  readonly resolveMuzzle: MuzzleResolver;
  readonly lookupProjectile: ProjectileLookup;
  readonly lookupZoneArmor: ZoneArmorLookup;
}

export class SimRunner {
  readonly world: SimWorld;
  readonly random: SimRandom;
  readonly commands: CommandBus;
  readonly clock: SimClock;
  readonly events: SimEventLog;
  private combat: CombatBindings | undefined;
  /** Reused tick-local queues to keep allocations off the hot path. */
  private pendingSpawns: PendingProjectileSpawn[] = [];
  private impacts: ImpactEvent[] = [];

  constructor(opts: SimRunnerOpts) {
    this.world = createSimWorld();
    this.random = new SimRandom(opts.seed);
    this.commands = new CommandBus();
    this.clock = new SimClock({ hz: opts.hz });
    this.events = new SimEventLog();
  }

  /**
   * Bind / replace the runtime-side combat callbacks. The runtime
   * calls this exactly once after constructing the runner + match
   * data. Re-binding mid-match is permitted but rare.
   */
  setCombatBindings(bindings: CombatBindings): void {
    this.combat = bindings;
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

    // 2. Stance enforcement (HoldFire clearing + pursuit decisions).
    stanceSystem(this.world);

    // 3. Target acquisition — per-hardpoint scoring (A.3).
    targetAcquisitionSystem(this.world);

    // 4. Weapon state machine + projectile spawn queue.
    //    Reset reusable buffers each tick.
    this.pendingSpawns.length = 0;
    this.impacts.length = 0;

    if (this.combat) {
      weaponFireSystem(
        this.world,
        dtSec,
        this.events,
        this.combat.resolveMuzzle,
        this.combat.lookupProjectile,
        this.pendingSpawns,
        tickId,
      );
      // 5. Materialise pending projectile spawns.
      projectileSpawnSystem(
        this.world,
        this.pendingSpawns,
        this.combat.lookupProjectile,
        this.events,
        tickId,
      );
      // 6. Advance projectiles, gather impact events.
      projectileSystem(
        this.world,
        dtSec,
        this.events,
        this.impacts,
        tickId,
      );
      // 7. Apply damage, tag Dead.
      impactSystem(
        this.world,
        this.impacts,
        this.events,
        tickId,
        this.combat.lookupProjectile,
        this.combat.lookupZoneArmor,
      );
      // 7.5. Phase 2 Stage 1 — bunkers heal friendly units in range.
      //      Runs AFTER damage applies but BEFORE deathSystem tags Dead,
      //      so a unit can be healed past 0 in the same tick it would
      //      otherwise die. (Net: bunker healing is a real survival tool,
      //      not a cosmetic post-mortem.)
      bunkerHealSystem(this.world);
      // 8. Death events + delayed despawn.
      deathSystem(this.world, this.events, tickId);
    } else {
      // Combat disabled but buildings still heal — bunker pulse runs
      // even in no-combat test paths so the system is exercised.
      bunkerHealSystem(this.world);
    }

    // 9. Movement. Walks each entity toward its current MovementTarget
    //    at MovementSpeed * dtSec; clears hasTarget on arrival so the
    //    render-side PathFollowController can queue the next waypoint.
    //    Runs AFTER stanceSystem so pursuit targets are honoured.
    movementSystem(this.world, dtSec);
  }
}
