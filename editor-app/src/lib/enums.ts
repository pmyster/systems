/**
 * Canonical enum value lists for the editor's typed dropdowns.
 *
 * These mirror the closed-string-literal unions declared in
 * src/types/unit.ts and src/types/part.ts and the discriminator
 * enums in src/lib/zod-schemas.ts. They are the *value-level* twins
 * of the *type-level* unions — the form layer needs both:
 *
 *   - the union (for compile-time exhaustiveness)
 *   - the literal value array (for runtime <option> rendering)
 *
 * If you add or rename a literal in the union, add it here too. The
 * `satisfies readonly T[]` constraint will catch drift at compile time.
 *
 * NOTE: per the lift map's OPEN[2026-05-27] question, these arrays
 * should one day be code-generated from schemas/unit.schema.json so
 * the schema is the single source of truth. Until that pipeline lands,
 * this file is hand-maintained — keep it minimal and grep-friendly.
 */

import type {
  ArmorMaterial,
  ChassisClass,
  CompatibilityTag,
  EnergySource,
  Faction,
  HardpointSlotType,
  StructureType,
  UnitRole,
} from "../types/unit";
import type {
  CommunicationsType,
  PartArmorMaterial,
  PartCategory,
  SensorModality,
  UtilityFunction,
  WeaponType,
} from "../types/part";

// ---------------------------------------------------------------------------
// Unit-level enums.
// ---------------------------------------------------------------------------

export const FACTIONS: readonly Faction[] = [
  "reclaimer",
  "bulwark",
  "signal",
  "cinder_crown",
  "neutral",
  "tethered",
  "quiet_court",
  "burnward",
  "drifters",
  "veiled",
] as const satisfies readonly Faction[];

export const CHASSIS_CLASSES: readonly ChassisClass[] = [
  "ground_tracked",
  "ground_wheeled",
  "ground_legged",
  "walker_fusion",
  "air_fixed_wing",
  "air_rotary",
  "naval_surface",
  "naval_submarine",
  "subterranean",
  "orbital",
  "static_structure",
  "static_wall",
] as const satisfies readonly ChassisClass[];

export const ENERGY_SOURCES: readonly EnergySource[] = [
  "battery",
  "fuel_cell",
  "fusion",
  "hybrid",
  "grid_tethered",
  "solar_only",
] as const satisfies readonly EnergySource[];

export const ARMOR_MATERIALS: readonly ArmorMaterial[] = [
  "salvaged_steel",
  "alloy_composite",
  "ceramic_layered",
  "exotic_lattice",
] as const satisfies readonly ArmorMaterial[];

export const COMPATIBILITY_TAGS: readonly CompatibilityTag[] = [
  "tracked",
  "wheeled",
  "legged",
  "tunneling",
  "displacement_hull",
  "vacuum_rated",
  "low_g_stable",
  "high_g_rated",
  "high_radiation",
  "thermal_extreme",
  "stealth_hull",
  "amphibious",
  "all_weather",
] as const satisfies readonly CompatibilityTag[];

export const ROLES: readonly UnitRole[] = [
  "scout",
  "light_attack",
  "main_battle",
  "heavy_assault",
  "artillery",
  "support",
  "air_fighter",
  "gunship",
  "naval",
  "structure",
  "elite",
] as const satisfies readonly UnitRole[];

export const STRUCTURE_TYPES: readonly StructureType[] = [
  "tower", "wall", "gate", "bunker", "factory", "depot", "relay",
] as const satisfies readonly StructureType[];

export const HARDPOINT_SLOT_TYPES: readonly HardpointSlotType[] = [
  "heavy_gun", "light_gun", "missile", "flak", "aux", "shield", "sensor", "gate",
] as const satisfies readonly HardpointSlotType[];

// ---------------------------------------------------------------------------
// Part-level enums.
// ---------------------------------------------------------------------------

export const PART_CATEGORIES: readonly PartCategory[] = [
  "weapon",
  "sensor",
  "defense",
  "mobility_aux",
  "utility",
  "communications",
] as const satisfies readonly PartCategory[];

export const WEAPON_TYPES: readonly WeaponType[] = [
  "kinetic",
  "beam",
  "missile",
  "thermal",
  "psionic",
] as const satisfies readonly WeaponType[];

export const SENSOR_MODALITIES: readonly SensorModality[] = [
  "visual",
  "radar",
  "sonar",
  "seismic",
  "thermal",
  "psionic",
  "lidar",
] as const satisfies readonly SensorModality[];

export const UTILITY_FUNCTIONS: readonly UtilityFunction[] = [
  "constructor",
  "repair",
  "medic",
  "transport",
  "scientist",
  "cloak",
  "jammer",
  "counter_jammer",
  "refueler",
  "miner",
  "scout_drone_bay",
] as const satisfies readonly UtilityFunction[];

export const COMMUNICATIONS_TYPES: readonly CommunicationsType[] = [
  "radio",
  "laser_link",
  "quantum_paired",
] as const satisfies readonly CommunicationsType[];

export const PART_ARMOR_MATERIALS: readonly PartArmorMaterial[] = [
  "salvaged_steel",
  "alloy_composite",
  "ceramic_layered",
  "exotic_lattice",
] as const satisfies readonly PartArmorMaterial[];

// ---------------------------------------------------------------------------
// Display labels — terse human-readable forms for dropdowns.
// Keep the underscore variant as the *value* (matches the schema); the
// label is purely cosmetic.
// ---------------------------------------------------------------------------

/**
 * Convert an enum literal like 'ground_tracked' into 'Ground Tracked'
 * for display in a dropdown. Pure formatting — never round-trip the
 * label back into state.
 */
export function humanizeEnum(value: string): string {
  return value
    .split("_")
    .map((s) => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)))
    .join(" ");
}
