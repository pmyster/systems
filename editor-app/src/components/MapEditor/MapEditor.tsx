/**
 * Map Editor — root shell.
 *
 * Day 2 wiring:
 *   - Mounts <MapCanvas /> which spins up the Three.js scene + camera.
 *   - Listens for Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) at the window
 *     level and forwards to the Command bus.
 *   - Guards against firing while typing in form inputs (mirrors the
 *     existing pattern in BattlefieldPreview/controls.ts).
 *
 * Day 3 layout:
 *   - Left ~220px rail: BrushPanel (tool select + sliders).
 *   - Right column: MapCanvas fills the remainder.
 *   - Right inspector pane comes later (Day 5+).
 *
 * Day 4 additions:
 *   - <MapMenuBar /> at the top of the shell — New/Open/Save/Save As.
 *   - Store subscriber marks the autosave loop dirty on any terrain /
 *     object / spawn-point change. Autosave timer starts on mount and
 *     stops on unmount.
 */

import { useEffect } from "react";

import { BrushPanel } from "./BrushPanel";
import { MapCanvas } from "./MapCanvas";
import { MapMenuBar } from "./MapMenuBar";
import { mapCommandBus } from "../../map/commands/CommandBus";
import {
  markMapDirty,
  startMapAutosave,
  stopMapAutosave,
} from "../../map/io/autosaveMap";
import { loadPrefabManifest } from "../../map/scene/prefabLoader";
import { useMapStore } from "../../map/state/mapStore";
import { useSettings } from "../../state/settings";

function isEditingInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function MapEditor() {
  // Global undo/redo keyboard shortcuts. We bind on window (not the
  // canvas) because focus may be anywhere — the brief explicitly wants
  // shortcuts to work from the editor shell, not just when the canvas
  // is focused.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditingInput(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        mapCommandBus.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        mapCommandBus.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Prefab manifest load — fires once on mount when Settings allows.
  // We don't await this in render path; the PrefabLibraryPanel polls
  // the registry for ~5 seconds after mount which covers the typical
  // GLB fetch+parse window. If the user has disabled "Scan on startup",
  // they trigger the scan manually via Settings → Scan now.
  useEffect(() => {
    if (!useSettings.getState().scanOnStartup) {
      console.info("[MapEditor] Prefab startup scan skipped (disabled in Settings).");
      return;
    }
    void loadPrefabManifest().then((r) => {
      console.info(
        `[MapEditor] Prefab manifest: ${r.loaded} loaded, ${r.builtins} built-in, ${r.failed.length} failed${r.failed.length ? ` (${r.failed.join(", ")})` : ""}.`,
      );
    });
  }, []);

  // Autosave wiring: subscribe to the store, mark dirty on any change
  // we care about, and run the 60s autosave loop. Zustand v5
  // `subscribe` fires on every state object replacement; we keep a
  // prev ref via the second arg shim below.
  useEffect(() => {
    let prevRevision = useMapStore.getState().terrain.revision;
    let prevObjects = useMapStore.getState().objects;
    let prevSpawns = useMapStore.getState().spawnPoints;
    const unsub = useMapStore.subscribe((s) => {
      if (
        s.terrain.revision !== prevRevision ||
        s.objects !== prevObjects ||
        s.spawnPoints !== prevSpawns
      ) {
        markMapDirty();
        prevRevision = s.terrain.revision;
        prevObjects = s.objects;
        prevSpawns = s.spawnPoints;
      }
    });
    startMapAutosave();
    return () => {
      unsub();
      stopMapAutosave();
    };
  }, []);

  return (
    <div className="map-editor-shell">
      <MapMenuBar />
      <div className="map-editor-body">
        <BrushPanel />
        <div className="map-editor-canvas-wrap">
          <MapCanvas />
        </div>
      </div>
    </div>
  );
}
