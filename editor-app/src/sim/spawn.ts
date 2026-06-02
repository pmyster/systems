/**
 * /sim/spawn.ts — Phase 1 Week 1C
 *
 * Pure, headless entity factory for the sim. Allocates one bitECS entity
 * and stamps the foundational components every unit needs (Position,
 * Rotation, Health, TeamId, UnitTypeId, Renderable).
 *
 * Why "pure"?
 *   This file lives under `/sim` so it must pass `npm run check:sim-purity`:
 *   NO wall-clock reads (Date.now, performance.now), NO Math.random.
 *   Determinism contract — two SimRunners with the same seed + the same
 *   spawn calls in the same order produce identical worlds. Position +
 *   quaternion arrive as numbers from the caller; the caller is the one
 *   responsible for any randomness (and only via SimRandom).
 *
 * Single-entity granularity:
 *   `spawnUnit` creates ONE entity. Multi-spawn orchestration (loops over
 *   plans, registry lookups, prefab registration with the renderer) lives
 *   one layer up in `/runtime/spawning/MatchSpawner.ts` — that layer knows
 *   about Three.js and the type registry, so it cannot live in `/sim`.
 *
 * Component set chosen here (and not more) because these are the six
 * components every unit needs on day one. Velocity / Path / Target /
 * SelectionTag etc. land when the system that consumes them lands — per
 * the "data shape follows the consumer, not the speculation" rule.
 */

import { addEntity, addComponent } from "bitecs";

import {
  Position,
  Rotation,
  Health,
  TeamId,
  UnitTypeId,
  Renderable,
  type SimWorld,
} from "./world";

/**
 * bitECS 0.4 next-API note:
 *   `addComponent(world, eid, component)` — entity id is the SECOND arg.
 *   The 0.3 legacy API had `(world, component, eid)`. We're on 0.4.
 *   The component schema arrays (e.g. `Position.x`) are still ArrayLike
 *   in shape but typed in this codebase via `bitecs-legacy.d.ts` as
 *   `ArrayLike<number> & { [i: number]: number }` — assignable like a
 *   plain typed-array slot.
 */

export interface SpawnParams {
  /** Index into the runtime UnitTypeRegistry. ui16-bounded. */
  readonly typeId: number;
  /** World-space spawn position in meters (Y is up). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Orientation as a unit quaternion (x, y, z, w). Identity = (0,0,0,1). */
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  /** Health.current + Health.max are both seeded to this value. */
  readonly maxHealth: number;
  /** Team / faction tag (0..255). */
  readonly teamId: number;
}

/**
 * Spawn ONE entity with the foundational component set. Returns the new
 * entity id so the caller can hold a reference (e.g. for spawn-point logs
 * or test assertions).
 *
 * Component ordering matches `world.ts` definition order — purely a
 * readability convention, not a determinism requirement (bitECS storage
 * is SoA and per-component, so add order doesn't affect layout).
 */
export function spawnUnit(world: SimWorld, p: SpawnParams): number {
  const eid = addEntity(world);

  addComponent(world, eid, Position);
  Position.x[eid] = p.x;
  Position.y[eid] = p.y;
  Position.z[eid] = p.z;

  addComponent(world, eid, Rotation);
  Rotation.x[eid] = p.qx;
  Rotation.y[eid] = p.qy;
  Rotation.z[eid] = p.qz;
  Rotation.w[eid] = p.qw;

  addComponent(world, eid, Health);
  Health.current[eid] = p.maxHealth;
  Health.max[eid] = p.maxHealth;

  addComponent(world, eid, TeamId);
  TeamId.value[eid] = p.teamId;

  addComponent(world, eid, UnitTypeId);
  UnitTypeId.value[eid] = p.typeId;

  // Tag component — empty schema. Marks this entity as a candidate for
  // the InstancedUnitRenderer sync each frame.
  addComponent(world, eid, Renderable);

  return eid;
}
