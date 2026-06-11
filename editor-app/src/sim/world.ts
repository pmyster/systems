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

// ---------------------------------------------------------------------
// Sentinel "no entity" id. bitECS allocates eids starting at 1 (the
// world reserves 0 as "no entity") so we can use 0 unambiguously here.
// Used by TargetOf, WeaponTarget, OwnerEid as the "unset" marker.
// ---------------------------------------------------------------------
export const NO_ENTITY = 0 as const;

/**
 * Sentinel "no projectile type" — written into ProjectileTypeId when a
 * weapon's projectile_id failed to load or was never authored. The
 * weaponFireSystem checks this and refuses to fire (with a one-time
 * warn). 0xFFFF == ui16 max.
 *
 * Mirrored by `NO_PROJECTILE_TYPE` in /runtime/ProjectileRegistry so
 * runtime code reads the same constant via that path (which is where
 * runtime/Sim layering says runtime code should look).
 */
export const NO_PROJECTILE_TYPE = 0xffff as const;

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

// ---------------------------------------------------------------------
// Phase 1 Week 3 — combat MVP components.
//
// Per A.3 of synthesis: per-hardpoint targeting. A unit with N
// hardpoints spawns N WeaponInstance entities — one entity per weapon,
// each carrying its own timing state, heat, and target. The "unit"
// entity carries only the unit-wide acquisition state (TargetOf,
// ScanRange, LeashOrigin, InCombat).
//
// Schema-field mapping (real authored names → ECS components):
//
//   UnitSchematic.vulnerability                 → consumed by impactSystem
//   UnitSchematic.hardpoints[].weapon_part_id   → resolves to a WeaponPart
//   WeaponPart.barrel_thermal_capacity_MJ       → WeaponThermalCapMj
//   WeaponPart.per_shot_heat_MJ                 → WeaponHeatPerShot
//   WeaponPart.cooling_rate_MJs                 → WeaponCoolRateMjs
//   WeaponPart.charge_time_ms                   → WeaponTiming defaults
//   WeaponPart.fire_rate_ms                     → WeaponTiming defaults
//   WeaponPart.burst_count                      → WeaponTiming defaults
//   WeaponPart.burst_delay_ms                   → WeaponTiming defaults
//   WeaponPart.cooldown_ms                      → WeaponTiming defaults
//   WeaponPart.projectile_id                    → ProjectileTypeId on the
//                                                 weapon (looked up via
//                                                 ProjectileRegistry at
//                                                 fire time).
//   ProjectileSchematic.delivery_params.kind    → ProjectileKind (ui8)
//   ProjectileSchematic.mass_kg                 → ProjectileMassKg
//   delivery_params (ballistic).muzzle_velocity_mps → projectile spawn vel
//
// Sim purity: this file imports ONLY bitECS. No render-side types.
// The component ARRAY of authored fields is mirrored into ECS at spawn
// time via the runtime-side MatchSpawner reading the schematic.
// ---------------------------------------------------------------------

/** Current acquired target for this unit. NO_ENTITY (=0) = no target. */
export const TargetOf = defineComponent({ value: Types.eid });

/** Unit's scan range in meters. Defaults to a weapon-derived value. */
export const ScanRange = defineComponent({ value: Types.f32 });

/** Stamped at spawn — origin of the leash that bounds pursuit. */
export const LeashOrigin = defineComponent({ x: Types.f32, z: Types.f32 });

/** Tag — currently engaged with a target. Empty schema. */
export const InCombat = defineComponent({});

/** Tag — entity is dead. atTick records the tick we tagged it for despawn. */
export const Dead = defineComponent({ atTick: Types.ui32 });

/** Weapon instance owner (eid of the owning unit). */
export const OwnerEid = defineComponent({ value: Types.eid });

/** Index into the unit's authored `hardpoints[]` for this weapon instance. */
export const WeaponHardpointIdx = defineComponent({ value: Types.ui16 });

/**
 * Weapon state-machine state. Matches WeaponStateValue below.
 * timerMs accumulates ms in the current state.
 * burstShotsFired counts shots emitted in the current burst.
 */
export const WeaponTiming = defineComponent({
  state: Types.ui8,
  timerMs: Types.f32,
  burstShotsFired: Types.ui8,
});

/** Authored timing fields cached on the weapon entity (ms). */
export const WeaponTimingSpec = defineComponent({
  chargeTimeMs: Types.f32,
  fireRateMs: Types.f32,
  burstCount: Types.ui16,
  burstDelayMs: Types.f32,
  cooldownMs: Types.f32,
});

/** Current barrel heat in MJ (mirrors WeaponPart.per_shot_heat_MJ accumulation). */
export const WeaponHeat = defineComponent({ currentMj: Types.f32 });

/** Authored thermal fields. */
export const WeaponThermalSpec = defineComponent({
  capacityMj: Types.f32, // barrel_thermal_capacity_MJ
  heatPerShotMj: Types.f32, // per_shot_heat_MJ
  coolRateMjs: Types.f32, // cooling_rate_MJs
});

/**
 * 1=true overheated lockout, 0=ready. Hysteresis: set when heat > 70%
 * capacity, cleared when heat < 60% capacity.
 */
export const WeaponOverheatLock = defineComponent({ value: Types.ui8 });

/** Per-weapon target entity. NO_ENTITY = no target. */
export const WeaponTarget = defineComponent({ value: Types.eid });

/** Effective range of this weapon in meters (derived at spawn time). */
export const WeaponRange = defineComponent({ value: Types.f32 });

/**
 * Index into the runtime ProjectileRegistry (mirrors UnitTypeId pattern).
 * The registry is owned by /runtime; the sim only reads numeric ids.
 * 0xFFFF = unassigned (weapon has no projectile linked, can't fire).
 */
export const ProjectileTypeId = defineComponent({ value: Types.ui16 });

/** Tag — this entity is a weapon instance (not a unit). Empty schema. */
export const WeaponInstanceTag = defineComponent({});

// ---------------------------------------------------------------------
// Projectile entity components.
// ---------------------------------------------------------------------

/** Tag — this entity is an in-flight projectile. */
export const ProjectileTag = defineComponent({});

/**
 * The owning weapon (so impacts can attribute damage). NO_ENTITY if the
 * weapon has been destroyed mid-flight (cleanup tolerates this).
 */
export const ProjectileOwner = defineComponent({ value: Types.eid });

/** Team id (so units don't damage themselves). */
export const ProjectileTeam = defineComponent({ value: Types.ui8 });

/** The entity this projectile is aimed at (used for guided + as range ref). */
export const ProjectileTarget = defineComponent({ value: Types.eid });

/**
 * Delivery kind discriminator. Matches DeliveryKindValue below.
 * Only ballistic + beam supported in v1 — others land in Phase 2.
 */
export const ProjectileKind = defineComponent({ value: Types.ui8 });

/** Index into runtime ProjectileRegistry for type-level data (schematic). */
export const ProjectileSchemaId = defineComponent({ value: Types.ui16 });

/** Distance traveled in m (for range falloff in impactSystem). */
export const ProjectileDistance = defineComponent({ value: Types.f32 });

/** Spawn origin (for distance tracking + beam render line). */
export const ProjectileOrigin = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Max range — projectile despawns past this with no impact. */
export const ProjectileMaxRange = defineComponent({ value: Types.f32 });

/** Lifetime in ms remaining (beams die after one frame; ballistic after timeout). */
export const ProjectileLifetimeMs = defineComponent({ value: Types.f32 });

// ---------------------------------------------------------------------
// Phase 2 Stage 1 — building components.
//
// Three new sim components gate the four building chassis classes'
// distinct behaviors. All three are deterministic typed-array stamps,
// registered in COMPONENT_REGISTRY below so the determinism hash sees
// them.
//
// AAFiringArc          → AA towers; targetAcquisitionSystem consults
//                        this to reject ground targets. Phase 2 Stage 1
//                        has no flying targets yet, so AA finds nothing
//                        and stays Idle (loud-warn-once log at startup).
//                        TODO(Stage 1+): when a "Flying" tag lands on
//                        aircraft units, replace pitchMinRad gating with
//                        a hasComponent(Flying) check.
//
// BunkerHealRange      → Bunkers; bunkerHealSystem reads radius +
//                        healPerTickMj each tick, adds to friendly Health
//                        within range (clamped at max). Loud-warns once
//                        per match if a bunker accidentally has no
//                        radius (radiusM === 0 would silently heal
//                        nobody — surface it).
//
// WallNoFire           → Walls; presence-only tag. The unit will not
//                        be added to per-team target candidate lists by
//                        allies (so an allied turret next to a wall
//                        doesn't pick the wall as a target). Enemies
//                        CAN still target walls (they soak damage).
//                        Walls also get no weapon instances spawned.
// ---------------------------------------------------------------------

/**
 * AA firing arc — pitch limits in radians.
 *
 * `pitchMinRad` is the minimum elevation (above the horizon) at which
 * the AA gun's target must sit. Targets below pitchMinRad are filtered
 * out by targetAcquisitionSystem. Default 0.35rad (~20°) — a reasonable
 * "must be airborne" gate.
 *
 * Stage 1 has no flying units; AA towers will acquire nothing. That's
 * correct. When aircraft land in a later phase, drop the per-target
 * elevation calc here and switch to a hasComponent(Flying) check.
 */
export const AAFiringArc = defineComponent({
  pitchMinRad: Types.f32,
  pitchMaxRad: Types.f32,
});

/**
 * Bunker heal radius + per-tick heal amount.
 *
 * `radiusM` — heal anything friendly within this Euclidean distance (2D,
 * XZ-plane). 0 = nobody gets healed (loud-warn at startup).
 *
 * `healPerTickMj` — added to Health.current per sim tick on each friendly
 * unit inside the radius. Clamped at Health.max so overhealing is
 * impossible. Named "Mj" to keep the heat/damage unit story coherent —
 * 1 MJ of structural-integrity restoration per tick is the v1 baseline.
 *
 * For Stage 1: 1 healPerTickMj × 30 ticks/sec = 30 MJ/sec of healing.
 * A 100-HP unit fully heals in ~3.3 seconds inside the radius. Tunable
 * per-building via the schematic.
 */
export const BunkerHealRange = defineComponent({
  radiusM: Types.f32,
  healPerTickMj: Types.f32,
});

/**
 * Wall tag — empty schema, presence is the signal. Walls:
 *   - Are NOT added to ALLIED target candidate lists (allies don't shoot
 *     own walls). Enemies still target them — walls soak damage by design.
 *   - Get NO weapon-instance entities spawned (MatchSpawner skips
 *     hardpoints for wall units; if a wall accidentally has hardpoints,
 *     MatchSpawner pushes a diagnostic).
 *
 * Empty schema, zero-cost as a bitECS tag.
 */
export const WallNoFire = defineComponent({});

// ---------------------------------------------------------------------
// Enums (closed unions stored as ui8). Authored as `as const` so callers
// get type narrowing.
// ---------------------------------------------------------------------

export const WeaponStateValue = {
  Idle: 0,
  Charging: 1,
  Bursting: 2,
  Cooldown: 3,
  /** Burst pause — waiting burst_delay_ms between shots. */
  BurstWait: 4,
} as const;
export type WeaponStateValueT =
  (typeof WeaponStateValue)[keyof typeof WeaponStateValue];

export const DeliveryKindValue = {
  Ballistic: 0,
  Beam: 1,
  Guided: 2,
  Placed: 3,
  Dropped: 4,
} as const;
export type DeliveryKindValueT =
  (typeof DeliveryKindValue)[keyof typeof DeliveryKindValue];

/**
 * Project-local alias for bitECS's world type so callers can write
 * `world: SimWorld` without importing bitECS directly. (Sticking to one
 * import surface in the sim makes future ECS swaps easier.)
 */
export type SimWorld = World;

export function createSimWorld(): SimWorld {
  return createWorld();
}

// ---------------------------------------------------------------------
// COMPONENT_REGISTRY — every entry here participates in determinism
// hashing (see /sim/replay.ts → hashSimState).
//
// If you add a component that's RENDER-DERIVED (no sim consequence — a
// muzzle-flash timer, a UI tag) leave it OUT and add a comment in the
// component definition above saying why. The registry is the SOURCE of
// truth for "what is sim state"; anything not here cannot influence
// replay outcome and is invisible to the hash.
//
// Adaptive-over-specific (CLAUDE.md): the hash iterates THIS array, not
// a hardcoded list of components inside replay.ts. A new sim component
// becomes visible to the hash by one line here — no second edit needed
// in the hasher. Conversely, a non-determinism-relevant component stays
// out by simple omission, which is the desired loud-over-silent gate.
//
// Field order within a component is the order the keys appear here. Keep
// it stable; a reordering changes the hash output for the SAME world
// state, which would falsely look like drift.
// ---------------------------------------------------------------------

/** One field within a component's hashing record. */
export interface ComponentRegistryField {
  readonly name: string;
  /** The typed-array storage bucket on the component. */
  readonly arr: ArrayLike<number>;
}

/** One component participating in determinism hashing. */
export interface ComponentRegistryEntry {
  readonly name: string;
  /** Used with `hasComponent(world, eid, component)` to filter live entities. */
  readonly component: object;
  readonly fields: readonly ComponentRegistryField[];
}

export const COMPONENT_REGISTRY: readonly ComponentRegistryEntry[] = [
  // Foundation
  { name: "Position", component: Position, fields: [
    { name: "x", arr: Position.x }, { name: "y", arr: Position.y }, { name: "z", arr: Position.z },
  ]},
  { name: "Rotation", component: Rotation, fields: [
    { name: "x", arr: Rotation.x }, { name: "y", arr: Rotation.y },
    { name: "z", arr: Rotation.z }, { name: "w", arr: Rotation.w },
  ]},
  { name: "Velocity", component: Velocity, fields: [
    { name: "x", arr: Velocity.x }, { name: "y", arr: Velocity.y }, { name: "z", arr: Velocity.z },
  ]},
  { name: "Health", component: Health, fields: [
    { name: "current", arr: Health.current }, { name: "max", arr: Health.max },
  ]},
  { name: "TeamId", component: TeamId, fields: [{ name: "value", arr: TeamId.value }] },
  { name: "UnitTypeId", component: UnitTypeId, fields: [{ name: "value", arr: UnitTypeId.value }] },
  // Selected is INTENTIONALLY EXCLUDED — UI-only tag, no sim consequence.
  // Renderable is INTENTIONALLY EXCLUDED — render-mirror flag only.
  // Movement
  { name: "MovementTarget", component: MovementTarget, fields: [
    { name: "x", arr: MovementTarget.x }, { name: "y", arr: MovementTarget.y },
    { name: "z", arr: MovementTarget.z }, { name: "hasTarget", arr: MovementTarget.hasTarget },
  ]},
  { name: "MovementSpeed", component: MovementSpeed, fields: [{ name: "value", arr: MovementSpeed.value }] },
  { name: "Stance", component: Stance, fields: [{ name: "value", arr: Stance.value }] },
  // Combat — unit-level
  { name: "TargetOf", component: TargetOf, fields: [{ name: "value", arr: TargetOf.value }] },
  { name: "ScanRange", component: ScanRange, fields: [{ name: "value", arr: ScanRange.value }] },
  { name: "LeashOrigin", component: LeashOrigin, fields: [
    { name: "x", arr: LeashOrigin.x }, { name: "z", arr: LeashOrigin.z },
  ]},
  { name: "Dead", component: Dead, fields: [{ name: "atTick", arr: Dead.atTick }] },
  // InCombat is a tag — presence matters; encode as "tag" with no fields.
  // Combat — weapon instance
  { name: "OwnerEid", component: OwnerEid, fields: [{ name: "value", arr: OwnerEid.value }] },
  { name: "WeaponHardpointIdx", component: WeaponHardpointIdx, fields: [{ name: "value", arr: WeaponHardpointIdx.value }] },
  { name: "WeaponTiming", component: WeaponTiming, fields: [
    { name: "state", arr: WeaponTiming.state },
    { name: "timerMs", arr: WeaponTiming.timerMs },
    { name: "burstShotsFired", arr: WeaponTiming.burstShotsFired },
  ]},
  { name: "WeaponTimingSpec", component: WeaponTimingSpec, fields: [
    { name: "chargeTimeMs", arr: WeaponTimingSpec.chargeTimeMs },
    { name: "fireRateMs", arr: WeaponTimingSpec.fireRateMs },
    { name: "burstCount", arr: WeaponTimingSpec.burstCount },
    { name: "burstDelayMs", arr: WeaponTimingSpec.burstDelayMs },
    { name: "cooldownMs", arr: WeaponTimingSpec.cooldownMs },
  ]},
  { name: "WeaponHeat", component: WeaponHeat, fields: [{ name: "currentMj", arr: WeaponHeat.currentMj }] },
  { name: "WeaponThermalSpec", component: WeaponThermalSpec, fields: [
    { name: "capacityMj", arr: WeaponThermalSpec.capacityMj },
    { name: "heatPerShotMj", arr: WeaponThermalSpec.heatPerShotMj },
    { name: "coolRateMjs", arr: WeaponThermalSpec.coolRateMjs },
  ]},
  { name: "WeaponOverheatLock", component: WeaponOverheatLock, fields: [{ name: "value", arr: WeaponOverheatLock.value }] },
  { name: "WeaponTarget", component: WeaponTarget, fields: [{ name: "value", arr: WeaponTarget.value }] },
  { name: "WeaponRange", component: WeaponRange, fields: [{ name: "value", arr: WeaponRange.value }] },
  { name: "ProjectileTypeId", component: ProjectileTypeId, fields: [{ name: "value", arr: ProjectileTypeId.value }] },
  // Projectile entity
  { name: "ProjectileOwner", component: ProjectileOwner, fields: [{ name: "value", arr: ProjectileOwner.value }] },
  { name: "ProjectileTeam", component: ProjectileTeam, fields: [{ name: "value", arr: ProjectileTeam.value }] },
  { name: "ProjectileTarget", component: ProjectileTarget, fields: [{ name: "value", arr: ProjectileTarget.value }] },
  { name: "ProjectileKind", component: ProjectileKind, fields: [{ name: "value", arr: ProjectileKind.value }] },
  { name: "ProjectileSchemaId", component: ProjectileSchemaId, fields: [{ name: "value", arr: ProjectileSchemaId.value }] },
  { name: "ProjectileDistance", component: ProjectileDistance, fields: [{ name: "value", arr: ProjectileDistance.value }] },
  { name: "ProjectileOrigin", component: ProjectileOrigin, fields: [
    { name: "x", arr: ProjectileOrigin.x }, { name: "y", arr: ProjectileOrigin.y }, { name: "z", arr: ProjectileOrigin.z },
  ]},
  { name: "ProjectileMaxRange", component: ProjectileMaxRange, fields: [{ name: "value", arr: ProjectileMaxRange.value }] },
  { name: "ProjectileLifetimeMs", component: ProjectileLifetimeMs, fields: [{ name: "value", arr: ProjectileLifetimeMs.value }] },
  // Phase 2 Stage 1 — buildings. AAFiringArc + BunkerHealRange carry sim
  // state read by their consuming systems; both go into the hash.
  // WallNoFire is a presence-only tag → COMPONENT_TAG_REGISTRY below.
  { name: "AAFiringArc", component: AAFiringArc, fields: [
    { name: "pitchMinRad", arr: AAFiringArc.pitchMinRad },
    { name: "pitchMaxRad", arr: AAFiringArc.pitchMaxRad },
  ]},
  { name: "BunkerHealRange", component: BunkerHealRange, fields: [
    { name: "radiusM", arr: BunkerHealRange.radiusM },
    { name: "healPerTickMj", arr: BunkerHealRange.healPerTickMj },
  ]},
];

/**
 * Tag components (empty schemas) that still influence sim outcome and
 * therefore must appear in the hash via "presence/absence" markers.
 * Kept as a separate list because they have no fields to enumerate but
 * their presence/absence is determinism-relevant.
 *
 * EXCLUDED on purpose:
 *   - Selected, Renderable — UI/render-only.
 *   - ProjectileTag, WeaponInstanceTag — discriminators consumed only
 *     by render-side queries; sim systems use ProjectileSchemaId /
 *     OwnerEid for their own filtering and never branch on these tags.
 *     They are part of the entity's "shape" but never change values
 *     mid-life, so excluding them does not hide drift.
 *   - InCombat — derived per-tick from TargetOf; presence here would
 *     double-count the same state.
 */
export const COMPONENT_TAG_REGISTRY: readonly { name: string; component: object }[] = [
  // Phase 2 Stage 1 — WallNoFire is presence-only AND determinism-relevant
  // (its presence/absence on an entity changes target-acquisition outcomes
  // for ally-side scoring). Adding it here means the replay hash sees a
  // diff if a wall is destroyed and the tag goes away, or if a wall is
  // missing the tag because of an authoring bug.
  { name: "WallNoFire", component: WallNoFire },
];
