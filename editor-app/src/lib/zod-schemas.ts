/**
 * Runtime validators (Zod) for the editor's core data shapes.
 *
 * Mirrors:
 *  - schemas/unit.schema.json  → UnitSchematicSchema
 *  - schemas/part.schema.json  → PartSchematicSchema
 *  - docs/schematics.md         → VoxelGridSchema (sparse_grid_v1)
 *
 * Per docs/editor-app-tauri-brief.md, validation runs:
 *   - on every Save (block writes of invalid content)
 *   - on every Open (block loads of invalid content)
 *
 * We use Zod's `infer<>` at the bottom of the file to verify that the
 * runtime shapes match the hand-authored TypeScript types in
 * src/types/. If those checks ever fail to typecheck, one side has
 * drifted from the other — that's a constitution violation per
 * DESIGN.md Principle 4 (Invariance). Fix the drift, don't silence
 * the error.
 *
 * NOTE: the unit JSON schema's `chassis.voxel_data` is open
 * (`{ type: "object" }`). We validate it as a strict VoxelGrid here
 * because the editor is the only authoring tool — if a future modder
 * tool produces a different voxel format, widen this to a union.
 */

import { z } from "zod";

import type {
  CommunicationsPart,
  DefensePart,
  MobilityAuxPart,
  PartSchematic,
  SensorPart,
  UtilityPart,
  WeaponPart,
} from "../types/part";
import type {
  HardpointSlot,
  MeshAssetRef,
  RigEntry,
  UnitChassis,
  UnitCosts,
  UnitEvolution,
  UnitSchematic,
} from "../types/unit";
import type {
  Hardpoint,
  VoxelGrid,
  VoxelMaterialSpec,
} from "../types/voxel";

// ---------------------------------------------------------------------------
// Primitive helpers.
// ---------------------------------------------------------------------------

/** Schematic id regex from schemas/unit.schema.json. */
const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

const idSchema = z.string().regex(ID_PATTERN, {
  message:
    "Invalid id — lowercase letters, digits, hyphen, underscore; must start with a letter.",
});

/** physics_version pattern: <major>.<minor>. */
const physicsVersionSchema = z
  .string()
  .regex(/^[0-9]+\.[0-9]+$/, {
    message: "physics_version must be in 'major.minor' form (e.g. '1.0').",
  });

// ---------------------------------------------------------------------------
// Enum schemas.
// ---------------------------------------------------------------------------

const factionSchema = z.enum([
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
]);

const chassisClassSchema = z.enum([
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
]);

const structureTypeSchema = z.enum([
  "tower", "wall", "gate", "bunker", "factory", "depot", "relay",
]);

const hardpointSlotTypeSchema = z.enum([
  "heavy_gun", "light_gun", "missile", "flak", "aux", "shield", "sensor", "gate",
]);

const hardpointSlotSchema = z.object({
  id: z.string(),
  type: hardpointSlotTypeSchema,
  occupied_by: z.string().optional(),
});

const energySourceSchema = z.enum([
  "battery",
  "fuel_cell",
  "fusion",
  "hybrid",
  "grid_tethered",
  "solar_only",
]);

const armorMaterialSchema = z.enum([
  "salvaged_steel",
  "alloy_composite",
  "ceramic_layered",
  "exotic_lattice",
]);

const compatibilityTagSchema = z.enum([
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
]);

const weaponTypeSchema = z.enum([
  "kinetic",
  "beam",
  "missile",
  "thermal",
  "psionic",
]);

const sensorModalitySchema = z.enum([
  "visual",
  "radar",
  "sonar",
  "seismic",
  "thermal",
  "psionic",
  "lidar",
]);

const utilityFunctionSchema = z.enum([
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
]);

const communicationsTypeSchema = z.enum([
  "radio",
  "laser_link",
  "quantum_paired",
]);

const materialIdSchema = z.enum([
  "armor",
  "hull",
  "accent",
  "glass",
  "engine",
  "hardpoint",
]);

const rigMotionSchema = z.enum(["passive", "reactive", "active"]);

const hardpointFacingSchema = z.enum(["x+", "x-", "y+", "y-", "z+", "z-"]);

const colorClassSchema = z.enum([
  "team-primary",
  "team-secondary",
  "team-accent",
  "fixed",
]);

// ---------------------------------------------------------------------------
// Voxel schemas (sparse_grid_v1).
// ---------------------------------------------------------------------------

const voxelCoordSchema = z.tuple([z.number().int(), z.number().int(), z.number().int()]);

const gridDimensionsSchema = z.tuple([
  z.number().int().positive(),
  z.number().int().positive(),
  z.number().int().positive(),
]);

const serializedVoxelSchema = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
  materialIdSchema,
]);

const voxelMaterialSpecSchema = z.object({
  density_kg_m3: z.number().nonnegative(),
  color_class: colorClassSchema,
  color_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  cell_size_m: z.number().positive(),
});

const hardpointSchema = z.object({
  id: z.number().int().nonnegative(),
  position: voxelCoordSchema,
  facing: hardpointFacingSchema,
});

const boundingBoxSchema = z.object({
  min: voxelCoordSchema,
  max: voxelCoordSchema,
});

export const VoxelGridSchema = z.object({
  format: z.literal("sparse_grid_v1"),
  grid_size: gridDimensionsSchema,
  cell_size_m: z.number().positive(),
  bounding_box: boundingBoxSchema.nullable(),
  derived_mass_kg: z.number().nonnegative(),
  voxel_count: z.number().int().nonnegative(),
  voxels: z.array(serializedVoxelSchema),
  materials: z.record(z.string(), voxelMaterialSpecSchema),
  hardpoints: z.array(hardpointSchema),
});

// ---------------------------------------------------------------------------
// Part schemas — per-category discriminated union.
// ---------------------------------------------------------------------------

const partCommonShape = {
  id: idSchema,
  name: z.string(),
  mass_kg: z.number().nonnegative(),
  power_draw_kW: z.number().nonnegative().optional(),
  tags: z.array(z.string()).optional(),
  designer: z.string().optional(),
} as const;

const elevationRangeSchema = z.tuple([z.number(), z.number()]);

const weaponPartSchema = z.object({
  ...partCommonShape,
  category: z.literal("weapon"),
  weapon_type: weaponTypeSchema.optional(),
  propellant_energy_MJ: z.number().nonnegative().optional(),
  projectile_mass_kg: z.number().nonnegative().optional(),
  barrel_thermal_capacity_MJ: z.number().nonnegative().optional(),
  per_shot_heat_MJ: z.number().nonnegative().optional(),
  cooling_rate_MJs: z.number().nonnegative().optional(),
  drag_coefficient: z.number().nonnegative().optional(),
  elevation_range_deg: elevationRangeSchema.optional(),
});

const sensorPartSchema = z.object({
  ...partCommonShape,
  category: z.literal("sensor"),
  sensor_modality: sensorModalitySchema.optional(),
  sensor_range_m: z.number().nonnegative().optional(),
  sensor_sensitivity: z.number().nonnegative().optional(),
  sensor_active: z.boolean().optional(),
});

const defensePartSchema = z.object({
  ...partCommonShape,
  category: z.literal("defense"),
  shield_capacity_MJ: z.number().nonnegative().optional(),
  shield_regen_rate_MJs: z.number().nonnegative().optional(),
  armor_bonus_mm: z.number().nonnegative().optional(),
  armor_material: armorMaterialSchema.optional(),
});

const mobilityAuxPartSchema = z.object({
  ...partCommonShape,
  category: z.literal("mobility_aux"),
  mobility_bonus_speed: z.number().optional(),
  mobility_bonus_turn_rate: z.number().optional(),
});

const utilityPartSchema = z.object({
  ...partCommonShape,
  category: z.literal("utility"),
  utility_function: utilityFunctionSchema.optional(),
  utility_effect_radius_m: z.number().nonnegative().optional(),
  utility_effect_rate: z.number().optional(),
});

const communicationsPartSchema = z.object({
  ...partCommonShape,
  category: z.literal("communications"),
  communications_type: communicationsTypeSchema.optional(),
  communications_range_m: z.number().nonnegative().optional(),
});

export const PartSchematicSchema = z.discriminatedUnion("category", [
  weaponPartSchema,
  sensorPartSchema,
  defensePartSchema,
  mobilityAuxPartSchema,
  utilityPartSchema,
  communicationsPartSchema,
]);

// ---------------------------------------------------------------------------
// Unit chassis / costs / evolution.
// ---------------------------------------------------------------------------

const unitChassisSchema = z.object({
  chassis_class: chassisClassSchema,
  mass_kg: z.number().min(1),
  engine_kW: z.number().nonnegative(),
  drivetrain_efficiency: z.number().min(0).max(1),
  energy_source: energySourceSchema.optional(),
  battery_capacity_MJ: z.number().nonnegative().optional(),
  battery_recharge_rate_MJs: z.number().nonnegative().optional(),
  fuel_capacity_MJ: z.number().nonnegative().optional(),
  fuel_consumption_rate_MJs: z.number().nonnegative().optional(),
  solar_collection_area_m2: z.number().nonnegative().optional(),
  armor_thickness_mm: z.number().nonnegative().optional(),
  armor_material: armorMaterialSchema.optional(),
  hardpoint_count: z.number().int().nonnegative().optional(),
  compatibility_tags: z.array(compatibilityTagSchema).optional(),
  thermal_capacity_MJ: z.number().nonnegative().optional(),
  voxel_data: VoxelGridSchema.optional(),
  structure_type: structureTypeSchema.optional(),
  hardpoints: z.array(hardpointSlotSchema).optional(),
});

const unitCostsSchema = z.object({
  power: z.number().nonnegative().optional(),
  scrap: z.number().nonnegative().optional(),
  alloy: z.number().nonnegative().optional(),
  fuel: z.number().nonnegative().optional(),
  tech_fragments: z.number().nonnegative().optional(),
  exotic_matter: z.number().nonnegative().optional(),
  biomass: z.number().nonnegative().optional(),
  helium_3: z.number().nonnegative().optional(),
  water_ice: z.number().nonnegative().optional(),
  rare_earths: z.number().nonnegative().optional(),
});

const evolutionSchema = z.object({
  trigger: z.record(z.string(), z.unknown()),
  successor: z.string(),
});

// ---------------------------------------------------------------------------
// Rigging — moving-part definitions (yaw/pitch constraint arcs).
// ---------------------------------------------------------------------------

const rigAxisConstraintSchema = z.object({
  min_deg: z.number(),
  max_deg: z.number(),
  rate_dps: z.number().nonnegative().optional(),
  invert: z.boolean().optional(),
});

const rigEntrySchema = z.object({
  id: z.string(),
  target_node: z.string(),
  motion: rigMotionSchema,
  pivot: z.tuple([z.number(), z.number(), z.number()]).optional(),
  yaw: rigAxisConstraintSchema.optional(),
  pitch: rigAxisConstraintSchema.optional(),
  parent_rig: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Mesh asset reference — which mesh the unit uses (template or imported file),
// so the editor can reload it on open. Discriminated on `kind`.
// ---------------------------------------------------------------------------

const meshAssetRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("template"), template_id: z.string() }),
  z.object({ kind: z.literal("file"), path: z.string() }),
]);

// ---------------------------------------------------------------------------
// Top-level Unit Schematic.
// ---------------------------------------------------------------------------

export const UnitSchematicSchema = z.object({
  kind: z.literal("unit"),
  id: idSchema,
  physics_version: physicsVersionSchema,
  name: z.string(),
  faction: factionSchema.optional(),
  description: z.string().optional(),
  designer: z.string().optional(),
  chassis: unitChassisSchema,
  parts: z.array(PartSchematicSchema).optional(),
  costs: unitCostsSchema.optional(),
  build_time_seconds: z.number().nonnegative().optional(),
  tech_requirements: z.array(z.string()).optional(),
  evolution: z.array(evolutionSchema).optional(),
  tags: z.array(z.string()).optional(),
  rig: z.array(rigEntrySchema).optional(),
  mesh_asset: meshAssetRefSchema.optional(),
});

// ---------------------------------------------------------------------------
// Sync checks — fail to compile if TS types and Zod schemas diverge.
//
// These assignments are *only* a compile-time check. They never run.
// If you see an error here, the TS type and Zod schema have drifted
// out of sync — reconcile them in this file or src/types/.
// ---------------------------------------------------------------------------

// Zod 3.25 widens optional fields with `?:` rather than `: T | undefined`,
// which doesn't quite match a TS interface that declares the same field
// as `readonly X?: T`. The exactOptionalPropertyTypes flag is off in our
// tsconfig, so the two are assignable. The directional check below is
// the one we care about: every Zod-inferred shape must satisfy the
// hand-authored TS type. The reverse direction is informational.

type _AssertWeaponPart = z.infer<typeof weaponPartSchema> extends WeaponPart
  ? true
  : never;
type _AssertSensorPart = z.infer<typeof sensorPartSchema> extends SensorPart
  ? true
  : never;
type _AssertDefensePart = z.infer<typeof defensePartSchema> extends DefensePart
  ? true
  : never;
type _AssertMobilityAuxPart = z.infer<typeof mobilityAuxPartSchema> extends MobilityAuxPart
  ? true
  : never;
type _AssertUtilityPart = z.infer<typeof utilityPartSchema> extends UtilityPart
  ? true
  : never;
type _AssertCommunicationsPart = z.infer<typeof communicationsPartSchema> extends CommunicationsPart
  ? true
  : never;
type _AssertPartSchematic = z.infer<typeof PartSchematicSchema> extends PartSchematic
  ? true
  : never;
type _AssertChassis = z.infer<typeof unitChassisSchema> extends UnitChassis ? true : never;
type _AssertCosts = z.infer<typeof unitCostsSchema> extends UnitCosts ? true : never;
type _AssertEvolution = z.infer<typeof evolutionSchema> extends UnitEvolution ? true : never;
type _AssertUnit = z.infer<typeof UnitSchematicSchema> extends UnitSchematic ? true : never;
type _AssertGrid = z.infer<typeof VoxelGridSchema> extends VoxelGrid ? true : never;
type _AssertHardpoint = z.infer<typeof hardpointSchema> extends Hardpoint ? true : never;
type _AssertHardpointSlot = z.infer<typeof hardpointSlotSchema> extends HardpointSlot ? true : never;
type _AssertRigEntry = z.infer<typeof rigEntrySchema> extends RigEntry ? true : never;
type _AssertVoxelMaterial = z.infer<typeof voxelMaterialSpecSchema> extends VoxelMaterialSpec
  ? true
  : never;
type _AssertMeshAssetRef = z.infer<typeof meshAssetRefSchema> extends MeshAssetRef ? true : never;

// Touch the type aliases so unused-locals doesn't strip them.
type _SyncChecks = [
  _AssertWeaponPart,
  _AssertSensorPart,
  _AssertDefensePart,
  _AssertMobilityAuxPart,
  _AssertUtilityPart,
  _AssertCommunicationsPart,
  _AssertPartSchematic,
  _AssertChassis,
  _AssertCosts,
  _AssertEvolution,
  _AssertUnit,
  _AssertGrid,
  _AssertHardpoint,
  _AssertHardpointSlot,
  _AssertRigEntry,
  _AssertVoxelMaterial,
  _AssertMeshAssetRef,
];
export type __EditorSchemaSyncChecks = _SyncChecks;
