/**
 * Pure selectors over UnitState. Components should prefer these over
 * reaching into `state.unit.foo` directly so any future state-shape
 * refactor lands in one place.
 */

import type { Faction, UnitSchematic } from "../types/unit";
import type { VoxelMap } from "../types/voxel";

import type { FileMeta, UnitState } from "./unit-store";

export function selectUnit(state: UnitState): UnitSchematic {
  return state.unit;
}

export function selectVoxels(state: UnitState): VoxelMap {
  return state.voxels;
}

export function selectMirrorX(state: UnitState): boolean {
  return state.mirrorX;
}

export function selectFaction(state: UnitState): Faction {
  return state.unit.faction ?? "neutral";
}

export function selectFile(state: UnitState): FileMeta {
  return state.file;
}

export function selectIsDirty(state: UnitState): boolean {
  return state.isDirty;
}

/**
 * Window-title string per docs/editor-app-tauri-brief.md.
 * Format: "Child of Light Editor — <filename> [unsaved]".
 */
export function selectWindowTitle(state: UnitState): string {
  const base = "Child of Light Editor";
  const fileLabel = state.file.displayName;
  const dirtyMark = state.isDirty ? " [unsaved]" : "";
  return `${base} — ${fileLabel}${dirtyMark}`;
}
