/**
 * Map editor menu bar — New / Open / Save / Save As + project path label.
 *
 * Sits above the BrushPanel + Canvas row, full width. Buttons map 1:1
 * to the projectIo public API. Save is disabled until a project has
 * been created or opened (matches the user expectation: "Save" goes to
 * the known path, "Save As..." prompts).
 *
 * Keyboard shortcuts (bound at window level, suppressed if focus is in
 * a form input — same guard as the Map editor undo/redo shortcuts):
 *   - Ctrl/Cmd+S      → Save
 *   - Ctrl/Cmd+Shift+S → Save As
 *
 * State strategy: each async handler awaits the projectIo call, then
 * `setProjectDir(getCurrentProjectDir())` so the label and Save-enable
 * state pick up the change. We deliberately do NOT subscribe to the
 * module singleton via a hook because there's exactly one component
 * that needs it; a setter inside the handlers is the simplest correct
 * thing.
 */

import { useEffect, useState } from "react";

import {
  getCurrentProjectDir,
  newMapProject,
  openMapProject,
  saveMapProject,
  saveMapProjectAs,
} from "../../map/io/projectIo";

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

export function MapMenuBar() {
  const [projectDir, setProjectDir] = useState<string | null>(
    getCurrentProjectDir(),
  );
  const [busy, setBusy] = useState(false);

  // Wrap any handler in busy-state so a slow disk doesn't let the user
  // queue up overlapping saves. Errors surface via console.warn for now
  // (a proper toast lands with the recovery banner — Week 2 deferred).
  const guarded = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.warn("[map menu] op failed:", e);
    } finally {
      setProjectDir(getCurrentProjectDir());
      setBusy(false);
    }
  };

  // Cmd/Ctrl+S / Cmd/Ctrl+Shift+S keyboard bindings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isEditingInput(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (e.shiftKey) {
        void guarded(saveMapProjectAs);
      } else {
        void guarded(saveMapProject);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  return (
    <div className="map-menu-bar">
      <button
        type="button"
        className="map-menu-button"
        disabled={busy}
        onClick={() => void guarded(newMapProject)}
      >
        New
      </button>
      <button
        type="button"
        className="map-menu-button"
        disabled={busy}
        onClick={() => void guarded(openMapProject)}
      >
        Open…
      </button>
      <button
        type="button"
        className="map-menu-button"
        disabled={busy || !projectDir}
        onClick={() => void guarded(saveMapProject)}
      >
        Save
      </button>
      <button
        type="button"
        className="map-menu-button"
        disabled={busy}
        onClick={() => void guarded(saveMapProjectAs)}
      >
        Save As…
      </button>
      <span className="map-project-path" title={projectDir ?? ""}>
        {projectDir ?? "(no project loaded)"}
      </span>
      <span
        className="map-menu-hint"
        title="A map project is a folder containing manifest.json + heightmap.r32 (per ADR 0002). The folder is the project."
      >
        📁 Projects are folders
      </span>
    </div>
  );
}
