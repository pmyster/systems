/**
 * TypeScript types for the Projectile Schematic.
 *
 * Hand-derived from schemas/projectile.schema.json. Projectiles are
 * STANDALONE files referenced by weapon parts via `projectile_id`.
 * Stored at units/projectiles/<id>.proj.json.
 *
 * Two orthogonal axes:
 *  - delivery: how it gets to the target (ballistic/guided/beam/placed/dropped)
 *  - effect:   what it does on arrival (kinetic/explosive/energy/electronic/persistent_area)
 *
 * The JSON Schema keeps `delivery` and `delivery_params` as separate
 * sibling fields (matching the conditional `if/then` pattern used
 * elsewhere in this repo). The TS shape collapses the discriminator
 * INTO the params object as `.kind`, so callers can `switch (p.kind)`
 * and get exhaustive narrowing without re-reading the parent field.
 * The on-disk JSON carries BOTH for redundancy + schema-validation
 * convenience; load/save bridge the two views.
 *
 * Per DESIGN.md Principle 2: every field here is a physical input.
 * Damage, range, penetration, blast radius are derived in
 * src/lib/derive-projectile.ts — they MUST NEVER appear in this type.
 *
 * Per DESIGN.md Principle 4: `physics_version` is `readonly` here so
 * the compiler refuses unintended mutation. Only the explicit
 * version-bump action may change it.
 */

// ---------------------------------------------------------------------------
// Discriminator enums.
// ---------------------------------------------------------------------------

export type DeliveryKind =
  | "ballistic"
  | "guided"
  | "beam"
  | "placed"
  | "dropped";

export type EffectKind =
  | "kinetic"
  | "explosive"
  | "energy"
  | "electronic"
  | "persistent_area";

export type PlacedTrigger = "proximity" | "timer" | "tripwire" | "command";

export type PenetratorMaterial = "steel" | "tungsten" | "du" | "composite";

export type EnergyMedium = "visible" | "ir" | "uv" | "particle" | "plasma";

export type PersistentAreaMedium = "gas" | "fire" | "smoke" | "acid";

export type ClusterTrigger = "altitude" | "proximity" | "timer";

// ---------------------------------------------------------------------------
// Delivery params — discriminated on .kind.
// ---------------------------------------------------------------------------

export interface BallisticDelivery {
  readonly kind: "ballistic";
  readonly muzzle_velocity_mps: number;
  readonly ballistic_coefficient: number;
}

export interface GuidedDelivery {
  readonly kind: "guided";
  readonly thrust_n: number;
  readonly fuel_mass_kg: number;
  /** 0..1 — fraction of perfect guidance. */
  readonly guidance_quality: number;
}

export interface BeamDelivery {
  readonly kind: "beam";
  readonly beam_power_kw: number;
  readonly dwell_time_s: number;
  readonly divergence_mrad: number;
}

export interface PlacedDelivery {
  readonly kind: "placed";
  readonly trigger_type: PlacedTrigger;
  readonly arming_delay_s: number;
  readonly lifetime_s: number;
}

export interface DroppedDelivery {
  readonly kind: "dropped";
  readonly drag_coefficient: number;
}

export type DeliveryParams =
  | BallisticDelivery
  | GuidedDelivery
  | BeamDelivery
  | PlacedDelivery
  | DroppedDelivery;

// ---------------------------------------------------------------------------
// Effect params — discriminated on .kind.
// ---------------------------------------------------------------------------

export interface KineticEffect {
  readonly kind: "kinetic";
  readonly penetrator_material: PenetratorMaterial;
  readonly sectional_density_kgm2: number;
}

export interface ExplosiveEffect {
  readonly kind: "explosive";
  readonly payload_mass_kg: number;
  readonly blast_yield_mj: number;
}

export interface EnergyEffect {
  readonly kind: "energy";
  readonly joules_delivered: number;
  readonly medium: EnergyMedium;
}

export interface ElectronicEffect {
  readonly kind: "electronic";
  readonly disruption_power_kw: number;
  readonly area_radius_m: number;
}

export interface PersistentAreaEffect {
  readonly kind: "persistent_area";
  readonly medium: PersistentAreaMedium;
  readonly duration_s: number;
  /** 0..1 normalized density. */
  readonly density: number;
}

export type EffectParams =
  | KineticEffect
  | ExplosiveEffect
  | EnergyEffect
  | ElectronicEffect
  | PersistentAreaEffect;

// ---------------------------------------------------------------------------
// Cluster modifier — optional.
// ---------------------------------------------------------------------------

export interface ClusterModifier {
  readonly trigger: ClusterTrigger;
  /** m, m, or s depending on trigger. */
  readonly trigger_value: number;
  readonly spread_radius_m: number;
  readonly child_projectile_id: string;
}

// ---------------------------------------------------------------------------
// Top-level projectile schematic.
// ---------------------------------------------------------------------------

export interface ProjectileSchematic {
  readonly id: string;
  readonly name: string;
  readonly physics_version: string;
  readonly mass_kg: number;
  /**
   * Delivery params — `.kind` discriminator narrows the union. The
   * on-disk JSON also carries a sibling `delivery: DeliveryKind` for
   * schema-validation; load/save keep the two in sync.
   */
  readonly delivery_params: DeliveryParams;
  /**
   * Effect params — `.kind` discriminator narrows the union. The
   * on-disk JSON also carries a sibling `effect: EffectKind` for
   * schema-validation; load/save keep the two in sync.
   */
  readonly effect_params: EffectParams;
  readonly cluster?: ClusterModifier;
  readonly physics_tags?: readonly string[];
}

/**
 * Derived stats — display-only computed values that the editor shows
 * in a stat panel. NEVER written back into the projectile; per
 * Principle 2 these are engine-side derivations and the editor's view
 * is an illustration. Engine MUST recompute from inputs.
 */
export interface DerivedProjectileStats {
  readonly kinetic_energy_kj: number;
  readonly recoil_impulse_ns: number;
  readonly est_penetration_mm: number;
  readonly est_blast_radius_m: number;
  readonly est_beam_intensity_kwm2: number;
}

// ---------------------------------------------------------------------------
// Convenience guards.
// ---------------------------------------------------------------------------

export function isBallistic(d: DeliveryParams): d is BallisticDelivery {
  return d.kind === "ballistic";
}
export function isGuided(d: DeliveryParams): d is GuidedDelivery {
  return d.kind === "guided";
}
export function isBeam(d: DeliveryParams): d is BeamDelivery {
  return d.kind === "beam";
}
export function isPlaced(d: DeliveryParams): d is PlacedDelivery {
  return d.kind === "placed";
}
export function isDropped(d: DeliveryParams): d is DroppedDelivery {
  return d.kind === "dropped";
}

export function isKinetic(e: EffectParams): e is KineticEffect {
  return e.kind === "kinetic";
}
export function isExplosive(e: EffectParams): e is ExplosiveEffect {
  return e.kind === "explosive";
}
export function isEnergy(e: EffectParams): e is EnergyEffect {
  return e.kind === "energy";
}
export function isElectronic(e: EffectParams): e is ElectronicEffect {
  return e.kind === "electronic";
}
export function isPersistentArea(e: EffectParams): e is PersistentAreaEffect {
  return e.kind === "persistent_area";
}
