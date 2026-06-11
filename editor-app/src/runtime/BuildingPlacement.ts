/**
 * BuildingPlacement — Phase 2 Stage 1
 *
 * The data the Match Setup → Place Buildings step produces and that
 * MatchSpawner consumes to instantiate buildings outside the team-cluster
 * grid.
 *
 * Why a dedicated module:
 *   - The type is shared by /runtime/MatchSetupScreen (UI authoring) and
 *     /runtime/spawning/MatchSpawner (entity creation). A standalone module
 *     keeps the import direction tidy.
 *   - Stages 2 (in-match build) + 3 (map-editor authoring) will produce
 *     BuildingPlacement[] from different sources but feed the SAME spawn
 *     path. Centralising the type here means those stages don't drift the
 *     shape.
 *
 * Coordinates:
 *   - `position_xz` is world-meters, NOT tile-pixels or normalized 0..1.
 *     The Match Setup UI handles the pixel-to-meter conversion when the
 *     user clicks the heightmap preview; storage stays meter-native so
 *     downstream consumers don't need the map at hand to interpret it.
 *   - `rotation_y` is yaw in RADIANS. Matches the existing
 *     spawnInitialUnits facingYawRad convention so the two paths compose.
 *   - The Y coordinate is intentionally NOT stored — the heightmap
 *     samples it at spawn time. This survives map edits that move the
 *     terrain up/down post-placement.
 *
 * Faction:
 *   - 0/1 are the two combat teams; 255 is the "neutral" sentinel for
 *     standalone buildings (e.g. a shared map decoration). Stage 1
 *     places team-affiliated buildings only; the neutral path lands when
 *     map-editor authoring ships (Stage 3).
 */

import type { BuildingChassisClass } from "../types/unit";

/** Sentinel for neutral (no-team) building placements. */
export const FACTION_NEUTRAL = 255 as const;

export interface BuildingPlacement {
  /** Which of the four Stage 1 building chassis classes. */
  readonly chassis_class: BuildingChassisClass;
  /** World-meter (x, z) — Y resolved at spawn time from the heightmap. */
  readonly position_xz: readonly [number, number];
  /** Yaw rotation in radians (around +Y). Defaults to 0 in the UI. */
  readonly rotation_y: number;
  /** Team id: 0, 1, or FACTION_NEUTRAL (255). */
  readonly faction: number;
}

/**
 * Clamp a position to map bounds. Loud-over-silent: returns a tuple
 * `[clamped_xz, wasClamped]` so the caller can warn when the user
 * placed off-map. Map dimensions in world meters.
 */
export function clampPlacementToMap(
  position: readonly [number, number],
  mapWidthM: number,
  mapDepthM: number,
): { readonly position: readonly [number, number]; readonly wasClamped: boolean } {
  const [x, z] = position;
  const cx = Math.max(0, Math.min(mapWidthM, x));
  const cz = Math.max(0, Math.min(mapDepthM, z));
  const wasClamped = cx !== x || cz !== z;
  return { position: [cx, cz] as const, wasClamped };
}
