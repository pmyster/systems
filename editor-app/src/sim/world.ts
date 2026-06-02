/**
 * /sim — ECS world wrapper and component definitions.
 *
 * Storage layout: Structure-of-Arrays (SoA) via bitECS legacy. Each
 * component is a dictionary of typed arrays indexed by entity id, so
 * a "system" loop becomes a tight numeric pass over contiguous memory
 * — the reason we picked bitECS over a class-based ECS for the runtime
 * hot path.
 *
 * Why both `bitecs` and `bitecs/legacy`?
 *   - `createWorld` lives in the main `bitecs` 0.4 module.
 *   - `defineComponent({ x: Types.f32, ... })` lives in `bitecs/legacy`.
 *   Both compose: components are just typed-array bundles, not registered
 *   anything; the world is just an opaque entity-id allocator. They are
 *   independent.
 *
 * Day-1 surface is intentionally minimal. Adding a component later is a
 * one-liner — but every new component is a new piece of synchronized
 * state, so we add them only when an actual system needs them (see the
 * "Adaptive over specific" rule in the engineering standards: data shape
 * follows the consumer, not the speculation).
 */

import { createWorld, type World } from "bitecs";
import { defineComponent, Types } from "bitecs/legacy";

/** 3-axis world position in meters. */
export const Position = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Quaternion rotation (x, y, z, w). */
export const Rotation = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
  w: Types.f32,
});

/** Linear velocity in m/s. */
export const Velocity = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Hit points — current vs. max. */
export const Health = defineComponent({
  current: Types.f32,
  max: Types.f32,
});

/** Team / faction tag (0..255 fits all reasonable factional designs). */
export const TeamId = defineComponent({ value: Types.ui8 });

/**
 * Index into the unit-type registry — the bridge between the data-driven
 * unit catalog and the hot-path ECS. Stays ui16 because we never expect
 * more than ~65k distinct unit *types* (units instances are a separate
 * dimension and live in entity ids).
 */
export const UnitTypeId = defineComponent({ value: Types.ui16 });

/**
 * Tag-style component (empty schema). Entities with `Renderable` get
 * mirrored into the Three.js view layer; entities without it stay
 * sim-internal. Implemented as an empty component because bitECS legacy
 * tags are zero-cost when the schema has no fields.
 */
export const Renderable = defineComponent({});

// ---------------------------------------------------------------------
// Phase 1 Week 2 — movement + selection + stance.
//
// These are the components the Week 2 systems consume:
//   - MovementTarget: where this entity is trying to go (one waypoint).
//   - MovementSpeed:  per-entity m/sec scalar.
//   - Selected:       UI-only tag; sim does NOT branch on it. The render
//                     side reads it to draw selection rings.
//   - Stance:         BAR-style behavior mode. Stub for Week 2 (default
//                     Defensive); the consumer is the combat / target
//                     acquisition system that lands Week 3.
//
// Per the "data shape follows the consumer" rule, we deliberately keep
// these minimal: ONE active waypoint per entity. The render-side
// PathFollowController owns the rest of the recast path and writes the
// next waypoint into MovementTarget when the sim signals arrival
// (hasTarget transitions 1 → 0). The waypoint queue does not live in
// the ECS — it lives in /runtime — because the path itself comes from
// recast (a /runtime concept), not from deterministic sim state.
// ---------------------------------------------------------------------

/**
 * Single active waypoint the movement system is steering toward.
 *
 * `hasTarget` is a 0/1 flag instead of a separate tag component so the
 * arrival signal is a cheap typed-array write — no per-frame
 * addComponent/removeComponent churn. The PathFollowController
 * (render side) polls this each frame to advance to the next recast
 * waypoint.
 */
export const MovementTarget = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
  hasTarget: Types.ui8,
});

/** Per-entity scalar walk/run speed in meters per second. */
export const MovementSpeed = defineComponent({ value: Types.f32 });

/**
 * UI-only selection tag. Empty schema — presence is the signal.
 * The sim NEVER reads this; only the render side (selection ring
 * pass, HUD count) checks it. Keeping it in ECS instead of a separate
 * Set<eid> means it lives or dies with the entity, no cross-system
 * sync to maintain.
 */
export const Selected = defineComponent({});

/**
 * BAR-style stance per the brief. Week 2 stubs all four values into a
 * single ui8 slot — the gameplay branches that read it land Week 3
 * with target acquisition + leash logic.
 */
export const Stance = defineComponent({ value: Types.ui8 });

/**
 * Stance enum values, in the order the brief specified. Exported as a
 * `const` literal so callers can write `StanceValue.Defensive` and get
 * type narrowing back. The Week 3 combat system will check these.
 */
export const StanceValue = {
  Aggressive: 0,
  Defensive: 1,
  HoldGround: 2,
  HoldFire: 3,
} as const;
export type StanceValueT = (typeof StanceValue)[keyof typeof StanceValue];

/**
 * Project-local alias for bitECS's world type so callers can write
 * `world: SimWorld` without importing bitECS directly. (Sticking to one
 * import surface in the sim makes future ECS swaps easier.)
 */
export type SimWorld = World;

export function createSimWorld(): SimWorld {
  return createWorld();
}
