/**
 * Single source of truth for the editor's magic numbers.
 *
 * These values match the prototypes byte-for-byte. If you change
 * one here, audit:
 *   - tools/voxel-editor/index.html lines 207-209 (originator)
 *   - tools/battlefield-viewer/index.html lines 168-175 (mirror)
 *   - docs/editor-app-tauri-brief.md (16x16x16 grid is called out)
 *
 * NOTE: per the brief, the v0.1 voxel grid is 16x16x16. The lift map
 * leaves the per-unit voxel budget OPEN. We expose VOXEL_BUDGET as a
 * symbolic constant; the value is provisional until docs/editor-app.md
 * resolves the open question.
 */

import type { GridDimensions, MaterialId } from "../types/voxel";

// ---------------------------------------------------------------------------
// Voxel grid geometry.
// ---------------------------------------------------------------------------

/** Grid resolution along each axis, in cells. */
export const GRID_SIZE = 16 as const;

/** Editor-side voxel grid dimensions tuple. */
export const VOXEL_DIMENSIONS: GridDimensions = [GRID_SIZE, GRID_SIZE, GRID_SIZE];

/** Edge length of one voxel cell in meters. */
export const CELL_SIZE_M = 0.5 as const;

/** Volume of one voxel cell in cubic meters. Precomputed. */
export const CELL_VOLUME_M3 = CELL_SIZE_M * CELL_SIZE_M * CELL_SIZE_M;

/** World-space scale to apply when rendering voxels (currently 1:1 with CELL_SIZE_M). */
export const VOXEL_SCALE = CELL_SIZE_M;

// ---------------------------------------------------------------------------
// Budgets / floors.
// ---------------------------------------------------------------------------

/**
 * Per-unit voxel budget — provisional. Resolves an OPEN question in
 * docs/editor-app.md. Set deliberately high so we don't block
 * sculpting work; tune down once the design owner picks a number.
 */
export const VOXEL_BUDGET = 4096 as const;

/**
 * Floor below which derive-stats refuses to compute "speed" — avoids
 * divide-by-zero / nonsense values for static structures or unfinished
 * units. Matches the prototype's `mass_t > 0` guard.
 */
export const MIN_MASS_KG = 1 as const;

/**
 * Default material density used by mass tooling when no material
 * spec is provided. Should never be used in practice — every voxel
 * in a valid sparse_grid_v1 has a registered material — but it gives
 * library code a deterministic fallback.
 */
export const GRID_DEFAULT_DENSITY_KG_M3 = 1000 as const;

// ---------------------------------------------------------------------------
// Battlefield (right pane) constants.
// ---------------------------------------------------------------------------

export const MAP_SIZE_M = 128 as const;
export const TERRAIN_AMP = 0 as const;

export const CAM_PITCH_MIN = Math.PI * 0.18;
export const CAM_PITCH_MAX = Math.PI * 0.44;
export const CAM_PITCH_DEFAULT = Math.PI * 0.32;

export const ZOOM_MIN = 25 as const;
export const ZOOM_MAX = 500 as const;
export const ZOOM_DEFAULT = 90 as const;

// ---------------------------------------------------------------------------
// Materials catalog.
// ---------------------------------------------------------------------------

/**
 * One material entry in the editor's known catalog. Mirrors the
 * MATERIALS array from tools/voxel-editor/index.html lines 198-205.
 * Per-material color is the *unrendered* default; faction palettes
 * may override at render time via color_class.
 */
export interface MaterialDef {
  readonly id: MaterialId;
  readonly name: string;
  /** Hex color as a 24-bit integer, e.g. 0x8a8a8a. */
  readonly color: number;
  /** Density in kg/m^3. */
  readonly density: number;
  /** Faction-color hook: 'primary' | 'secondary' | 'accent' | 'fixed'. */
  readonly team: "primary" | "secondary" | "accent" | "fixed";
  readonly desc: string;
}

/**
 * The six materials the editor knows. Lifted verbatim from
 * tools/voxel-editor/index.html lines 198-205.
 */
export const MATERIALS: readonly MaterialDef[] = [
  { id: "armor",     name: "Armor",     color: 0x8a8a8a, density: 7800, team: "primary",   desc: "High-density plating. Heavy. Tinted with team-primary." },
  { id: "hull",      name: "Hull",      color: 0xb5b5b5, density: 2700, team: "secondary", desc: "Structural framing. Lighter. Tinted with team-secondary." },
  { id: "accent",    name: "Accent",    color: 0xc9a55c, density: 4500, team: "accent",    desc: "Decorative or load-bearing accent. Tinted with team-accent." },
  { id: "glass",     name: "Glass",     color: 0x6bb3c9, density: 2500, team: "fixed",     desc: "Transparent panel. Fixed color. Used for windows, sensors." },
  { id: "engine",    name: "Engine",    color: 0xe07050, density: 4000, team: "fixed",     desc: "Reactor / engine glow. Fixed color. Generates heat in-game." },
  { id: "hardpoint", name: "Hardpoint", color: 0xc9a55c, density: 500,  team: "fixed",     desc: "A mount point for parts. Lightweight marker. Glows." },
] as const;

/** O(1) lookup of a material by id. */
export const MATERIAL_BY_ID: Readonly<Record<MaterialId, MaterialDef>> = Object.freeze(
  MATERIALS.reduce(
    (acc, m) => {
      acc[m.id] = m;
      return acc;
    },
    {} as Record<MaterialId, MaterialDef>,
  ),
);

/** Default Schematic physics_version stamped on newly created units. */
export const DEFAULT_PHYSICS_VERSION = "1.0" as const;

/** Marker `designer` for stock content shipped with the base game. */
export const STARTER_KIT_DESIGNER = "STARTER_KIT" as const;
