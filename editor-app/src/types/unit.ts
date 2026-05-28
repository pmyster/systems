/**
 * TypeScript types for the Unit Schematic.
 *
 * Hand-derived from schemas/unit.schema.json. If the schema changes,
 * update this file in lockstep. The Zod schema in src/lib/zod-schemas.ts
 * is the runtime guard that mirrors these types — keep them in sync
 * (z.infer<typeof UnitSchematicSchema> should equal UnitSchematic).
 *
 * NOTE: per DESIGN.md Principle 2 (Derived-stat discipline), every field
 * here is a *physical input*. Speed, range, damage, cooldown are NEVER
 * stored on the Schematic — they are derived by the engine (and, for
 * preview, by src/lib/derive-stats.ts).
 *
 * NOTE: per DESIGN.md Principle 4 (Invariance: amend, never alter),
 * once a unit is authored at a given physics_version, that version is
 * fixed for the life of the Schematic. Bumping it is an explicit user
 * action — see docs/editor-app-tauri-brief.md.
 */

import type { PartSchematic } from "./part";
import type { VoxelGrid } from "./voxel";

// ---------------------------------------------------------------------------
// Enums (closed string literal unions matching schemas/unit.schema.json).
// ---------------------------------------------------------------------------

export type UnitKind = "unit";

export type Faction =
  | "reclaimer"
  | "bulwark"
  | "signal"
  | "cinder_crown"
  | "neutral"
  | "tethered"
  | "quiet_court"
  | "burnward"
  | "drifters"
  | "veiled";

export type ChassisClass =
  | "ground_tracked"
  | "ground_wheeled"
  | "ground_legged"
  | "walker_fusion"
  | "air_fixed_wing"
  | "air_rotary"
  | "naval_surface"
  | "naval_submarine"
  | "subterranean"
  | "orbital"
  | "static_structure";

export type EnergySource =
  | "battery"
  | "fuel_cell"
  | "fusion"
  | "hybrid"
  | "grid_tethered"
  | "solar_only";

export type ArmorMaterial =
  | "salvaged_steel"
  | "alloy_composite"
  | "ceramic_layered"
  | "exotic_lattice";

export type CompatibilityTag =
  | "tracked"
  | "wheeled"
  | "legged"
  | "tunneling"
  | "displacement_hull"
  | "vacuum_rated"
  | "low_g_stable"
  | "high_g_rated"
  | "high_radiation"
  | "thermal_extreme"
  | "stealth_hull"
  | "amphibious"
  | "all_weather";

export type UnitRole =
  | "scout"
  | "light_attack"
  | "main_battle"
  | "heavy_assault"
  | "artillery"
  | "support"
  | "air_fighter"
  | "gunship"
  | "naval"
  | "structure"
  | "elite";

// ---------------------------------------------------------------------------
// Chassis — the body of the unit. Physical inputs only.
// ---------------------------------------------------------------------------

export interface UnitChassis {
  readonly chassis_class: ChassisClass;
  readonly mass_kg: number;
  readonly engine_kW: number;
  readonly drivetrain_efficiency: number;
  readonly energy_source?: EnergySource;
  readonly battery_capacity_MJ?: number;
  readonly battery_recharge_rate_MJs?: number;
  readonly fuel_capacity_MJ?: number;
  readonly fuel_consumption_rate_MJs?: number;
  readonly solar_collection_area_m2?: number;
  readonly armor_thickness_mm?: number;
  readonly armor_material?: ArmorMaterial;
  readonly hardpoint_count?: number;
  readonly compatibility_tags?: readonly CompatibilityTag[];
  readonly thermal_capacity_MJ?: number;
  /**
   * Optional sculpted voxel chassis (sparse_grid_v1).
   * The unit schema marks this `object` (open). We type it strictly
   * here against VoxelGrid for the editor's purposes; if the engine
   * later accepts other voxel formats, widen this to a discriminated
   * union keyed on `format`.
   */
  readonly voxel_data?: VoxelGrid;
}

// ---------------------------------------------------------------------------
// Costs — per-resource build cost (one-time stockpile + per-tick power).
// ---------------------------------------------------------------------------

export interface UnitCosts {
  readonly power?: number;
  readonly scrap?: number;
  readonly alloy?: number;
  readonly fuel?: number;
  readonly tech_fragments?: number;
  readonly exotic_matter?: number;
  readonly biomass?: number;
  readonly helium_3?: number;
  readonly water_ice?: number;
  readonly rare_earths?: number;
}

// ---------------------------------------------------------------------------
// Evolution triggers — a unit may evolve into a successor under conditions.
// The schema only constrains `trigger` to be an object; we type it as a
// loose record here so the form can author any condition shape the engine
// later recognizes.
// ---------------------------------------------------------------------------

export type EvolutionTrigger = Readonly<Record<string, unknown>>;

export interface UnitEvolution {
  readonly trigger: EvolutionTrigger;
  readonly successor: string;
}

// ---------------------------------------------------------------------------
// Top-level Unit Schematic.
// ---------------------------------------------------------------------------

/**
 * Meta-only slice of a unit (kind/id/version/identity fields). Useful for
 * code paths that need to know *which* unit they hold without depending
 * on chassis/parts.
 */
export interface UnitMeta {
  readonly kind: UnitKind;
  readonly id: string;
  readonly physics_version: string;
  readonly name: string;
  readonly faction?: Faction;
  readonly description?: string;
  readonly designer?: string;
}

/**
 * A complete unit Schematic — chassis + parts + costs + meta.
 *
 * Mirrors schemas/unit.schema.json exactly. Fields marked readonly to make
 * accidental mutation a type error; the editor's form layer keeps a
 * mutable working copy and only freezes back into this shape at
 * serialization time.
 */
export interface UnitSchematic extends UnitMeta {
  readonly chassis: UnitChassis;
  readonly parts?: readonly PartSchematic[];
  readonly costs?: UnitCosts;
  readonly build_time_seconds?: number;
  readonly tech_requirements?: readonly string[];
  readonly evolution?: readonly UnitEvolution[];
  readonly tags?: readonly string[];
  readonly role?: UnitRole;
}

/**
 * Convenience re-export name. The lift map mentions "UnitWeapon" in
 * passing as "whatever the schema defines"; weapons in the schema are
 * just parts with `category === 'weapon'`. Code that wants a narrowed
 * weapon type should use the discriminated PartSchematic union from
 * ./part and the narrow helpers there.
 */
export type UnitPart = PartSchematic;
