/**
 * Pure coordinate-conversion helpers for the Map Editor.
 *
 * All functions are pure (no globals, no side effects) so they can be
 * shared between the renderer thread, a future worker, and the Rust
 * side via wasm-bindgen if we ever go there.
 *
 * See `docs/adr/0001-map-editor-coordinate-system.md` for the conventions.
 *
 * Convention reminders:
 *   - World origin (0, 0, 0) is the SW corner.
 *   - +X = east, +Z = south, +Y = up.
 *   - Heightmap pixel (0, 0) is at world (0, h, 0). Pixel (w-1, h-1) is
 *     at world ((w-1)*m_per_px, h, (h-1)*m_per_px).
 *   - Tile (0, 0) covers world X in [0, TILE_SIZE_M) and Z in [0, TILE_SIZE_M).
 */

import { HEIGHTMAP_M_PER_PIXEL, TILE_SIZE_M } from "./constants";

/**
 * Convert world-XZ coordinates to heightmap pixel coordinates (fractional).
 *
 * Returns floats; round/floor at the call site depending on whether you
 * want a vertex index, a sample index, or a brush footprint.
 *
 * `worldX = 0, worldZ = 0` → pixel `(0, 0)`.
 * `worldX = 128, worldZ = 128` (default map SE corner) → pixel `(128, 128)`.
 */
export function worldToHeightmap(
  worldX: number,
  worldZ: number,
): { px: number; py: number } {
  return {
    px: worldX / HEIGHTMAP_M_PER_PIXEL,
    py: worldZ / HEIGHTMAP_M_PER_PIXEL,
  };
}

/**
 * Convert heightmap pixel coordinates back to world XZ (pixel center).
 *
 * Inverse of `worldToHeightmap` for integer pixel inputs.
 */
export function heightmapToWorld(
  px: number,
  py: number,
): { x: number; z: number } {
  return {
    x: px * HEIGHTMAP_M_PER_PIXEL,
    z: py * HEIGHTMAP_M_PER_PIXEL,
  };
}

/**
 * Convert world-XZ to tile indices (integer; floor toward -inf).
 *
 * Tile (tx, tz) covers world-X in [tx*TILE_SIZE_M, (tx+1)*TILE_SIZE_M).
 */
export function worldToTile(
  worldX: number,
  worldZ: number,
): { tx: number; tz: number } {
  return {
    tx: Math.floor(worldX / TILE_SIZE_M),
    tz: Math.floor(worldZ / TILE_SIZE_M),
  };
}

/**
 * Convert tile index to world-XZ at the tile center.
 *
 * `tx=0, tz=0` → world `(0.5, 0.5)` for a 1m tile.
 */
export function tileToWorld(
  tx: number,
  tz: number,
): { x: number; z: number } {
  return {
    x: (tx + 0.5) * TILE_SIZE_M,
    z: (tz + 0.5) * TILE_SIZE_M,
  };
}

// Inline dev self-tests removed Day 2 — see coordinateSystem.test.ts
// for the Vitest-driven equivalents.
