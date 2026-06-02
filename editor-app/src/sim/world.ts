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

/**
 * Project-local alias for bitECS's world type so callers can write
 * `world: SimWorld` without importing bitECS directly. (Sticking to one
 * import surface in the sim makes future ECS swaps easier.)
 */
export type SimWorld = World;

export function createSimWorld(): SimWorld {
  return createWorld();
}
