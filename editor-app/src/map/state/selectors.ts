/**
 * Stable selectors for the Map Editor store.
 *
 * Why selectors:
 *   - Zustand re-renders any component whose selector returns a value with
 *     a different reference. Building inline `(s) => s.brush` selectors at
 *     call sites works but is harder to grep when something causes a
 *     surprise re-render. Centralising selectors here gives one obvious
 *     place to inspect.
 *   - Each selector returns either a primitive or the same reference
 *     between renders unless its slice changed, so React re-render
 *     isolation is preserved without extra memoization.
 */

import type { MapState } from "./mapStore";

export const selectTerrainRevision = (s: MapState): number =>
  s.terrain.revision;
export const selectTool = (s: MapState): MapState["tool"] => s.tool;
export const selectBrush = (s: MapState): MapState["brush"] => s.brush;
export const selectObjectIds = (s: MapState): string[] =>
  Object.keys(s.objects);
export const selectSelection = (s: MapState): MapState["selection"] =>
  s.selection;
