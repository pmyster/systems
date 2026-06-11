/**
 * Map editor autosave loop — fires every 60s when the map is dirty AND
 * a project directory is set, writing a snapshot into
 * `<projectdir>/.autosave/`. Best-effort: any failure is logged at
 * WARNING and the dirty flag stays set so the next tick retries.
 *
 * Why not on every edit:
 *   - Sculpt strokes can fire dozens of revision bumps per second.
 *     Encoding 129*129*4 = 66kB and round-tripping to Rust every time
 *     would crater the editor's frame budget.
 *   - 60s gives us a sane upper bound on "lost work after an OOM" while
 *     keeping the I/O pressure trivial.
 *
 * Why not when no project is loaded:
 *   - Without a project directory there's nowhere to put the snapshot
 *     that the next session could find. The unit-editor's autosave uses
 *     `$APPDATA/childoflight-editor/autosave/...` for the same reason;
 *     map-editor projects are directory-scoped so the autosave lives
 *     IN the project. The recovery banner (Week 2 deferred) will look
 *     in the most-recently-opened project's `.autosave/`.
 */

import { invoke } from "@tauri-apps/api/core";

import { _buildBundleFromStore, getCurrentProjectDir } from "./projectIo";

const AUTOSAVE_INTERVAL_MS = 60_000;
let timerHandle: number | null = null;
let dirty = false;

/** Mark the map dirty — call from the store subscriber on any edit. */
export function markMapDirty(): void {
  dirty = true;
}

/** Start the autosave loop. Idempotent. */
export function startMapAutosave(): void {
  if (timerHandle !== null) return;
  timerHandle = window.setInterval(async () => {
    if (!dirty) return;
    const dir = getCurrentProjectDir();
    if (!dir) return;
    try {
      const bundle = _buildBundleFromStore();
      await invoke("autosave_map_project", { dir, bundle });
      dirty = false;
      console.warn(`[map autosave] wrote snapshot to ${dir}/.autosave/`);
    } catch (e) {
      console.warn("[map autosave] failed:", e);
      // Leave dirty=true so the next tick retries.
    }
  }, AUTOSAVE_INTERVAL_MS);
}

/** Stop the autosave loop. Safe to call multiple times. */
export function stopMapAutosave(): void {
  if (timerHandle !== null) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

/** Test-only: peek at the dirty flag. */
export function _isMapDirty(): boolean {
  return dirty;
}

/** Test-only: clear the dirty flag without triggering a save. */
export function _clearMapDirty(): void {
  dirty = false;
}
