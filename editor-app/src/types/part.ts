/**
 * TypeScript types for the Part Schematic.
 *
 * Hand-derived from schemas/part.schema.json. The schema is a single
 * polymorphic object where many fields are optional and a few are
 * relevant only for certain categories. We expose two views:
 *
 *  1. PartSchematicBase — the union of all fields the schema accepts.
 *     The Zod schema validates against this shape (every field optional
 *     except id/category/name/mass_kg).
 *
 *  2. PartSchematic — a discriminated union keyed on `category`. Each
 *     branch narrows the optional-field surface area to what makes
 *     sense for that category. The form layer uses this to render the
 *     right inputs and to keep useful invariants (e.g. a sensor part
 *     has no propellant_energy_MJ).
 *
 * Authors who *must* round-trip an out-of-band field (e.g. mod content)
 * should use PartSchematicBase directly.
 *
 * NOTE: per DESIGN.md Principle 2, every value here is a physical input.
 * Damage and effective range are never authored — they're derived.
 */

// ---------------------------------------------------------------------------
// Enums.
// ---------------------------------------------------------------------------

export type PartCategory =
  | "weapon"
  | "sensor"
  | "defense"
  | "mobility_aux"
  | "utility"
  | "communications";

export type WeaponType = "kinetic" | "beam" | "missile" | "thermal" | "psionic";

export type SensorModality =
  | "visual"
  | "radar"
  | "sonar"
  | "seismic"
  | "thermal"
  | "psionic"
  | "lidar";

export type UtilityFunction =
  | "constructor"
  | "repair"
  | "medic"
  | "transport"
  | "scientist"
  | "cloak"
  | "jammer"
  | "counter_jammer"
  | "refueler"
  | "miner"
  | "scout_drone_bay";

export type CommunicationsType = "radio" | "laser_link" | "quantum_paired";

export type PartArmorMaterial =
  | "salvaged_steel"
  | "alloy_composite"
  | "ceramic_layered"
  | "exotic_lattice";

// ---------------------------------------------------------------------------
// Common fields — present on every category.
// ---------------------------------------------------------------------------

export interface PartCommon {
  readonly id: string;
  readonly name: string;
  readonly mass_kg: number;
  readonly power_draw_kW?: number;
  readonly tags?: readonly string[];
  readonly designer?: string;
}

// ---------------------------------------------------------------------------
// Category-specific branches.
// ---------------------------------------------------------------------------

/** Elevation range [min_deg, max_deg]. Two-tuple, both ends inclusive. */
export type ElevationRange = readonly [number, number];

export interface WeaponPart extends PartCommon {
  readonly category: "weapon";
  readonly weapon_type?: WeaponType;
  readonly propellant_energy_MJ?: number;
  readonly projectile_mass_kg?: number;
  readonly barrel_thermal_capacity_MJ?: number;
  readonly per_shot_heat_MJ?: number;
  readonly cooling_rate_MJs?: number;
  readonly drag_coefficient?: number;
  readonly elevation_range_deg?: ElevationRange;
}

export interface SensorPart extends PartCommon {
  readonly category: "sensor";
  readonly sensor_modality?: SensorModality;
  readonly sensor_range_m?: number;
  readonly sensor_sensitivity?: number;
  readonly sensor_active?: boolean;
}

export interface DefensePart extends PartCommon {
  readonly category: "defense";
  readonly shield_capacity_MJ?: number;
  readonly shield_regen_rate_MJs?: number;
  readonly armor_bonus_mm?: number;
  readonly armor_material?: PartArmorMaterial;
}

export interface MobilityAuxPart extends PartCommon {
  readonly category: "mobility_aux";
  readonly mobility_bonus_speed?: number;
  readonly mobility_bonus_turn_rate?: number;
}

export interface UtilityPart extends PartCommon {
  readonly category: "utility";
  readonly utility_function?: UtilityFunction;
  readonly utility_effect_radius_m?: number;
  readonly utility_effect_rate?: number;
}

export interface CommunicationsPart extends PartCommon {
  readonly category: "communications";
  readonly communications_type?: CommunicationsType;
  readonly communications_range_m?: number;
}

/**
 * Discriminated union of all part categories. Use this in form code,
 * derive-stats, and renderers — `switch (part.category)` narrows
 * automatically.
 */
export type PartSchematic =
  | WeaponPart
  | SensorPart
  | DefensePart
  | MobilityAuxPart
  | UtilityPart
  | CommunicationsPart;

/**
 * Permissive shape — every field optional except the four required by
 * the JSON schema. Use for round-tripping unknown fields or for parsing
 * untrusted input before narrowing.
 */
export interface PartSchematicBase extends PartCommon {
  readonly category: PartCategory;
  readonly weapon_type?: WeaponType;
  readonly propellant_energy_MJ?: number;
  readonly projectile_mass_kg?: number;
  readonly barrel_thermal_capacity_MJ?: number;
  readonly per_shot_heat_MJ?: number;
  readonly cooling_rate_MJs?: number;
  readonly drag_coefficient?: number;
  readonly elevation_range_deg?: ElevationRange;
  readonly sensor_modality?: SensorModality;
  readonly sensor_range_m?: number;
  readonly sensor_sensitivity?: number;
  readonly sensor_active?: boolean;
  readonly shield_capacity_MJ?: number;
  readonly shield_regen_rate_MJs?: number;
  readonly armor_bonus_mm?: number;
  readonly armor_material?: PartArmorMaterial;
  readonly mobility_bonus_speed?: number;
  readonly mobility_bonus_turn_rate?: number;
  readonly utility_function?: UtilityFunction;
  readonly utility_effect_radius_m?: number;
  readonly utility_effect_rate?: number;
  readonly communications_type?: CommunicationsType;
  readonly communications_range_m?: number;
}

// ---------------------------------------------------------------------------
// Type guards — convenience for narrowing a PartSchematic union.
// ---------------------------------------------------------------------------

export function isWeapon(p: PartSchematic): p is WeaponPart {
  return p.category === "weapon";
}
export function isSensor(p: PartSchematic): p is SensorPart {
  return p.category === "sensor";
}
export function isDefense(p: PartSchematic): p is DefensePart {
  return p.category === "defense";
}
export function isMobilityAux(p: PartSchematic): p is MobilityAuxPart {
  return p.category === "mobility_aux";
}
export function isUtility(p: PartSchematic): p is UtilityPart {
  return p.category === "utility";
}
export function isCommunications(p: PartSchematic): p is CommunicationsPart {
  return p.category === "communications";
}
