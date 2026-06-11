/**
 * Types for the sparse_grid_v1 voxel format described in
 * docs/schematics.md. This is the on-disk shape the voxel sculptor
 * writes into a unit's chassis.voxel_data field and that the
 * battlefield renderer consumes.
 *
 * The prototype's payload (tools/voxel-editor/index.html lines 607-652)
 * has slightly more fields than docs/schematics.md formally specifies
 * — derived_mass_kg, voxel_count, bounding_box. They're cached
 * derivations from `voxels`; the engine will recompute them. We type
 * them as optional so the format remains forgiving to hand-edited
 * files.
 *
 * NOTE: per DESIGN.md Principle 2, derived_mass_kg / voxel_count /
 * bounding_box must NEVER be the source of truth. The serializer fills
 * them as a convenience; the loader recomputes from `voxels`. See
 * src/lib/voxel-stats.ts.
 */

// ---------------------------------------------------------------------------
// Coordinates and color tokens.
// ---------------------------------------------------------------------------

/** A 3D voxel index in grid space. Integer triple. */
export type VoxelCoord = readonly [number, number, number];

/** Three-dimensional axis-aligned grid dimensions, in cells. */
export type GridDimensions = readonly [number, number, number];

/** Material identifier; matches one of the MATERIALS catalog entries. */
export type MaterialId = "armor" | "hull" | "accent" | "glass" | "engine" | "hardpoint";

/**
 * A six-digit hex color string. Format: '#RRGGBB' (lowercase or upper).
 * Used as fixed-color fallback when a material has no team color class.
 */
export type VoxelColor = string;

/**
 * How a material's color is resolved at render time.
 *  - 'team-primary' | 'team-secondary' | 'team-accent' — tinted by faction.
 *  - 'fixed' — color_hex is used verbatim.
 */
export type ColorClass = "team-primary" | "team-secondary" | "team-accent" | "fixed";

// ---------------------------------------------------------------------------
// Voxel-format payload primitives.
// ---------------------------------------------------------------------------

/**
 * A serialized voxel entry, exactly as written in sparse_grid_v1:
 *   [x, y, z, material_id]
 * Tuple form is the on-disk shape; library code may also use the
 * object-form Voxel below internally when readability matters.
 */
export type SerializedVoxel = readonly [number, number, number, MaterialId];

/** Object-form voxel for library code. */
export interface Voxel {
  readonly coord: VoxelCoord;
  readonly material: MaterialId;
}

/**
 * Per-material metadata baked into a sparse_grid_v1 payload so the
 * renderer can resolve colors and densities without consulting an
 * external catalog. Matches what the voxel editor writes.
 */
export interface VoxelMaterialSpec {
  readonly density_kg_m3: number;
  readonly color_class: ColorClass;
  readonly color_hex: VoxelColor;
  readonly cell_size_m: number;
}

/** Map of material id → its spec. */
export type VoxelMaterialMap = Readonly<Record<string, VoxelMaterialSpec>>;

// ---------------------------------------------------------------------------
// Hardpoints — voxel cells flagged as part-mount points.
// ---------------------------------------------------------------------------

/**
 * Direction a hardpoint faces. The prototype emits all hardpoints with
 * 'y+'; future placement UI may infer from neighbor occupancy.
 * NOTE: this enum is currently *not* in schemas/, so the editor owns it.
 * See OPEN[2026-05-27] in docs/editor-app-tauri-lift-map.md.
 */
export type HardpointFacing = "x+" | "x-" | "y+" | "y-" | "z+" | "z-";

export interface Hardpoint {
  readonly id: number;
  readonly position: VoxelCoord;
  readonly facing: HardpointFacing;
}

// ---------------------------------------------------------------------------
// Axis-aligned bounding box in grid coords.
// ---------------------------------------------------------------------------

export interface BoundingBox {
  readonly min: VoxelCoord;
  readonly max: VoxelCoord;
}

// ---------------------------------------------------------------------------
// Top-level voxel grid (sparse_grid_v1).
// ---------------------------------------------------------------------------

/** Format tag for sparse_grid_v1. */
export type VoxelFormat = "sparse_grid_v1";

/**
 * The canonical sparse_grid_v1 payload.
 *
 * This is what gets written to unit.chassis.voxel_data and what the
 * battlefield renderer / engine read back.
 *
 * Field order is intentional — it matches the prototype's exportJSON
 * output and the recommended canonical-JSON ordering. The serializer
 * in src/lib/voxel-grid.ts preserves it.
 */
export interface VoxelGrid {
  readonly format: VoxelFormat;
  readonly grid_size: GridDimensions;
  readonly cell_size_m: number;
  readonly bounding_box: BoundingBox | null;
  readonly derived_mass_kg: number;
  readonly voxel_count: number;
  readonly voxels: readonly SerializedVoxel[];
  readonly materials: VoxelMaterialMap;
  readonly hardpoints: readonly Hardpoint[];
}

/**
 * Backwards-compat alias. The brief mentions
 *   `type VoxelGrid = { format: 'sparse_grid_v1', dimensions, voxels }`
 * with a `dimensions` field rather than `grid_size`. The prototype's
 * actual on-disk name is `grid_size`. We keep the prototype's name to
 * avoid breaking saved files and expose this alias so brief-level docs
 * and lift-map code can still reach the same type.
 *
 * NOTE: the lift-map's `dimensions` is conceptual; the on-disk format
 * uses `grid_size`. If the schema later adds an explicit voxel-format
 * spec, reconcile here.
 */
export type SparseGridV1 = VoxelGrid;

/**
 * In-memory editor representation — a mutable sparse map from coord
 * key ("x,y,z") to material id. The renderer reconciles the Three.js
 * scene from this state; the serializer derives the on-disk
 * VoxelGrid from this state.
 *
 * Keys are stringified coords (matching prototype 2 line 314) to keep
 * Map equality semantics simple. A future optimization could pack
 * (x,y,z) into a single integer key — see
 * docs/editor-app-tauri-lift-map.md OPEN[2026-05-27].
 */
export type VoxelMap = ReadonlyMap<string, MaterialId>;
export type MutableVoxelMap = Map<string, MaterialId>;

/**
 * Computed voxel statistics. Pure derivation from a VoxelMap or
 * VoxelGrid. Per Principle 2 these are never persisted as the source
 * of truth — they're recomputed on demand.
 */
export interface VoxelStats {
  readonly voxelCount: number;
  readonly massKg: number;
  readonly boundingBox: BoundingBox | null;
}
