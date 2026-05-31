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
import type { VulnerabilityProfile } from "./vulnerability";
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
  | "static_structure"
  | "static_wall";

export type StructureType =
  | "tower" | "wall" | "gate" | "bunker" | "factory" | "depot" | "relay";

export type HardpointSlotType =
  | "heavy_gun" | "light_gun" | "missile" | "flak"
  | "aux" | "shield" | "sensor" | "gate";

export interface HardpointSlot {
  readonly id: string;
  readonly type: HardpointSlotType;
  readonly occupied_by?: string;
}

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
// Rigging — moving-part definitions (turrets, barrels, etc.).
//
// A rig binds a named mesh node to a motion mode. `reactive` rigs aim within
// the yaw/pitch constraint arcs; `passive` rigs auto-spin/roll; `active` rigs
// drive an animation state machine. Recoil is derived from weapon physics —
// never authored here.
// ---------------------------------------------------------------------------

export type RigMotion = "passive" | "reactive" | "active";

/**
 * Local-axis label for the rig node's "barrel forward" direction. A unit
 * vector along that axis (in the node's local space) is transformed by the
 * node's world quaternion at fire time to yield the world-space firing
 * direction. Physical input only — no derived semantics live here.
 */
export type MuzzleForwardAxis = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

export interface RigAxisConstraint {
  readonly min_deg: number;
  readonly max_deg: number;
  readonly rate_dps?: number;
  readonly invert?: boolean;
}

/**
 * MeshHardpoint — an artist-placed weapon-mount socket.
 *
 * A hardpoint is a transform: a local position + local quaternion attached to
 * either the unit root or one of the unit's rig nodes (via `parent_rig_id`).
 * The engine spawns projectiles at the hardpoint's world position, flying
 * along its world +Z axis (Three.js convention: `getWorldDirection()` returns
 * the +Z direction in world space).
 *
 * Per DESIGN.md Principle 2 (Derived-stat discipline) this is a pure physical
 * input — both `local_position` and `local_quaternion` are facts about where
 * the muzzle sits in space; no derived gameplay values live here.
 *
 * NAMED "MeshHardpoint" (not bare "Hardpoint") to avoid a barrel-export
 * collision with the voxel-grid `Hardpoint` symbol already exported from
 * `./voxel` via `types/index.ts`. Two distinct concepts with the same word —
 * the prefix disambiguates without renaming the older type.
 */
export interface MeshHardpoint {
  /** Unique within the unit, e.g. "main_gun". */
  readonly id: string;
  /**
   * Id of the rig whose `target_node` this hardpoint is parented to in the
   * Battlefield Preview. Null = parented to the unit root (no rig follow).
   */
  readonly parent_rig_id: string | null;
  /** Local-space position of the hardpoint relative to its parent. */
  readonly local_position: readonly [number, number, number];
  /**
   * Local-space orientation of the hardpoint relative to its parent, as a
   * unit quaternion in (x, y, z, w) order matching THREE.Quaternion.
   */
  readonly local_quaternion: readonly [number, number, number, number];
  /**
   * Optional reference to a `parts[]` entry with `category === "weapon"`. When
   * set, this hardpoint fires that weapon's projectile (and respects its
   * timing model: charge → burst → cooldown). When absent or pointing to a
   * deleted/non-weapon part, the hardpoint is "unarmed" and cannot fire —
   * the fire-test bar shows a disabled checkbox and the form shows a
   * warning chip. Loud-over-silent: a stale reference is surfaced, not
   * dropped.
   */
  readonly weapon_part_id?: string;
}

export interface RigEntry {
  readonly id: string;
  readonly target_node: string;
  readonly motion: RigMotion;
  readonly pivot?: readonly [number, number, number];
  readonly yaw?: RigAxisConstraint;
  readonly pitch?: RigAxisConstraint;
  readonly parent_rig?: string;
  /**
   * When true, this rig is the projectile's spawn point AND aim direction
   * for the Fire-Test. At most one rig per unit may be flagged the muzzle
   * — the authoring UI enforces this when toggling the flag on. Optional
   * for backwards compat (Principle 4: Invariance — old units fall back to
   * the legacy bbox top-front + south aim).
   */
  readonly muzzle?: boolean;
  /**
   * Local axis of the rig's `target_node` that points OUT of the barrel.
   * Default `"+z"`. Only meaningful when `muzzle === true`.
   */
  readonly muzzle_forward?: MuzzleForwardAxis;
}

// ---------------------------------------------------------------------------
// Chassis — the body of the unit. Physical inputs only.
// ---------------------------------------------------------------------------

export interface UnitChassis {
  readonly chassis_class: ChassisClass;
  readonly mass_kg: number;
  /**
   * Overall unit scale factor applied at runtime ONLY (not at authoring time).
   * 1.0 = base imported size after 8-unit normalization. 0.7 = ~30% smaller.
   * 1.5 = 50% larger. Cubic relationship to mass — when scale changes, mass should
   * scale by scale^3 if volume conservation is desired (designer's choice).
   *
   * SUPERSEDED BY `length_m`: when both are set, `length_m` wins. Kept here
   * for backwards compatibility with units authored before the Option C
   * world-meters refactor.
   */
  readonly scale?: number;
  /**
   * Target rendered size of the unit's longest bbox dimension, in world
   * meters. When set, this is the AUTHORITATIVE scale knob — the runtime
   * scales the mesh so its longest axis equals `length_m` and ignores
   * `chassis.scale`. Default rendered size when both are absent: the
   * mesh-loader's `NORMALIZE_TARGET_M` (8 m).
   *
   * Why this exists: post-Option-C the mesh root carries scale (1,1,1)
   * and every coordinate downstream is in world meters. `length_m` is
   * the natural unit to author "this tank is 9 meters long" — no
   * multiplier algebra, no model-natural-size knowledge required.
   */
  readonly length_m?: number;
  /**
   * Coordinate-system version for the unit's `hardpoints[].local_position`
   * field. `"world_m"` (the post-Option-C convention) means positions are
   * in world meters. `"pre_bake"` (or the field being absent) means the
   * positions were authored against a mesh root with a non-unit scale
   * applied — the runtime multiplies them by the mesh's `normalizeScale`
   * at mount time to migrate them to meters, and a console warning prompts
   * the user to re-save.
   *
   * Brand-new units stamped by the editor get `"world_m"` automatically.
   */
  readonly hardpoint_units_version?: "pre_bake" | "world_m";
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
  readonly structure_type?: StructureType;
  readonly hardpoints?: readonly HardpointSlot[];
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
// Mesh asset reference — records which mesh the unit uses so the editor can
// reload it on open (rebuild a built-in template, or load the imported file).
// ---------------------------------------------------------------------------

export type MeshAssetRef =
  | { readonly kind: "template"; readonly template_id: string }
  | { readonly kind: "file"; readonly path: string };

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
  readonly rig?: readonly RigEntry[];
  readonly role?: UnitRole;
  readonly mesh_asset?: MeshAssetRef;
  /**
   * Artist-placed weapon-mount sockets. Each carries a full local
   * position + quaternion transform; the runtime parents them to the
   * referenced rig (or to the unit root when `parent_rig_id` is null)
   * and reads world position + +Z direction at fire time. Optional for
   * backwards compatibility — old units without this field load fine
   * and fall back to the legacy rig/muzzle_forward path (Principle 4).
   */
  readonly hardpoints?: readonly MeshHardpoint[];
  /**
   * Per-zone armor + electronics + crew + thermal physical inputs.
   * The interaction resolver reads ONLY from this block when computing
   * outcomes against this unit. Required on the TS type so the resolver
   * never has to guard against missing data; the load path materializes
   * defaults from chassis fields if an older file omits it (Principle 4:
   * Invariance — amend, never alter; old units keep loading).
   */
  readonly vulnerability: VulnerabilityProfile;
}

/**
 * Convenience re-export name. The lift map mentions "UnitWeapon" in
 * passing as "whatever the schema defines"; weapons in the schema are
 * just parts with `category === 'weapon'`. Code that wants a narrowed
 * weapon type should use the discriminated PartSchematic union from
 * ./part and the narrow helpers there.
 */
export type UnitPart = PartSchematic;
