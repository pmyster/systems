import { useCallback, useEffect, useRef, useState } from "react";

import "./App.css";

import { AttributeForm } from "./components/AttributeForm";
import { BattlefieldPreview } from "./components/BattlefieldPreview";
import { MenuBar } from "./components/MenuBar";
import { VoxelSculptor } from "./components/VoxelSculptor";
import { startAutosave, type AutosaveHandle } from "./file-ops";
import {
  UnitStateProvider,
  useUnitState,
} from "./state";
import {
  selectFaction,
  selectIsDirty,
  selectMirrorX,
  selectUnit,
  selectVoxels,
  selectWindowTitle,
} from "./state/selectors";
import type { UnitSchematic, VoxelMap } from "./types";

/**
 * Child of Light Editor - root shell.
 *
 * Three-pane layout per docs/editor-app-tauri-brief.md:
 *   - Left: Voxel chassis sculptor (Three.js, sparse_grid_v1)
 *   - Center: Attribute form (physical inputs only, per DESIGN.md Principle 2)
 *   - Right: Battlefield preview (top-down Three.js, TA-style camera)
 *
 * All three panes consume the shared UnitState via the React Context
 * provider defined in src/state. App owns the side-effects: window
 * title, autosave timer, before-unload guard. Pure rendering and state
 * mutation live elsewhere.
 */

function AppShell() {
  const { state, dispatch } = useUnitState();

  // Live selectors - recomputed each render, free.
  const unit: UnitSchematic = selectUnit(state);
  const voxels: VoxelMap = selectVoxels(state);
  const mirrorX = selectMirrorX(state);
  const faction = selectFaction(state);
  const isDirty = selectIsDirty(state);
  const windowTitle = selectWindowTitle(state);

  // Status notice surfaced by MenuBar (save errors, etc.).
  const [notice, setNotice] = useState<string | null>(null);

  // --- Pane callbacks: thin wrappers around dispatch ---------------------

  const handleVoxelsChange = useCallback(
    (next: VoxelMap) => {
      dispatch({ type: "SetVoxels", voxels: next });
    },
    [dispatch],
  );

  const handleMirrorXChange = useCallback(
    (next: boolean) => {
      dispatch({ type: "SetMirrorX", mirrorX: next });
    },
    [dispatch],
  );

  const handleUnitChange = useCallback(
    (next: UnitSchematic) => {
      dispatch({ type: "SetUnit", unit: next });
    },
    [dispatch],
  );

  // --- Window title ------------------------------------------------------
  useEffect(() => {
    document.title = windowTitle;
  }, [windowTitle]);

  // --- Before-unload guard ----------------------------------------------
  useEffect(() => {
    if (!isDirty) return undefined;
    const onBeforeUnload = (ev: BeforeUnloadEvent): void => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [isDirty]);

  // --- Autosave ----------------------------------------------------------
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const handle: AutosaveHandle = startAutosave(() => stateRef.current);
    return () => {
      handle.stop();
    };
  }, []);

  const overflowHidden: React.CSSProperties = { overflow: "hidden" };

  return (
    <div className="app-shell">
      <header className="app-header">
        <MenuBar notice={notice} setNotice={setNotice} />
      </header>
      <main className="workspace">
        <section className="pane pane-left" aria-label="Voxel chassis sculptor">
          <div className="pane-header">Voxel Sculptor</div>
          <div className="pane-body" style={overflowHidden}>
            <VoxelSculptor
              voxels={voxels}
              onVoxelsChange={handleVoxelsChange}
              faction={faction}
              mirrorX={mirrorX}
              onMirrorXChange={handleMirrorXChange}
            />
          </div>
        </section>
        <section className="pane pane-center" aria-label="Attribute form">
          <div className="pane-header">Attributes</div>
          <div className="pane-body">
            <AttributeForm unit={unit} onUnitChange={handleUnitChange} />
          </div>
        </section>
        <section className="pane pane-right" aria-label="Battlefield preview">
          <div className="pane-header">Battlefield Preview</div>
          <div className="pane-body">
            <BattlefieldPreview unit={unit} />
          </div>
        </section>
      </main>
      <footer className="app-footer">
        <span className="status">
          {state.file.path
            ? "Path: " + state.file.path
            : "Unsaved - File then Save to set a path"}
          {isDirty ? " | unsaved changes" : ""}
        </span>
      </footer>
    </div>
  );
}

function App() {
  return (
    <UnitStateProvider>
      <AppShell />
    </UnitStateProvider>
  );
}

export default App;
