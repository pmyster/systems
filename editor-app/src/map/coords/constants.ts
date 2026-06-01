/**
 * Canonical coordinate-system constants for the Map Editor.
 *
 * See `docs/adr/0001-map-editor-coordinate-system.md` for the rationale.
 * Every numeric coordinate constant in the map subsystem MUST be imported
 * from this file — no magic numbers anywhere else.
 */

/** Size of one logical map tile in world meters. */
export const TILE_SIZE_M = 1.0;

/** Physical spacing between adjacent heightmap pixels, in world meters. */
export const HEIGHTMAP_M_PER_PIXEL = 1.0;

/** Conversion ratio between Three.js world units and meters. */
export const WORLD_M_PER_UNIT = 1.0;

/** Default heightmap grid width (vertices, not tiles). */
export const DEFAULT_HEIGHTMAP_WIDTH_PX = 129;

/** Default heightmap grid height (vertices, not tiles). */
export const DEFAULT_HEIGHTMAP_HEIGHT_PX = 129;

/** Default map width in meters (= (width_px - 1) * m_per_pixel). */
export const DEFAULT_MAP_WIDTH_M =
  (DEFAULT_HEIGHTMAP_WIDTH_PX - 1) * HEIGHTMAP_M_PER_PIXEL; // 128

/** Default map depth in meters. */
export const DEFAULT_MAP_DEPTH_M =
  (DEFAULT_HEIGHTMAP_HEIGHT_PX - 1) * HEIGHTMAP_M_PER_PIXEL; // 128

/**
 * Up axis. Three.js native, matches Unit editor.
 * Literal type so any future code that tries to switch this gets a
 * type error at the call site rather than a silent bug.
 */
export const UP_AXIS: "Y" = "Y";
