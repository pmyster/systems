import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import "./App.css";

import { AttributeForm } from "./components/AttributeForm";
import { BattlefieldPreview } from "./components/BattlefieldPreview";
import { MenuBar } from "./components/MenuBar";
import { MeshWorkspace } from "./components/MeshWorkspace";
import { startAutosave, getAutosavePath, type AutosaveHandle } from "./file-ops";
import {
  UnitStateProvider,
  useUnitState,
} from "./state";
import { MeshAssetProvider } from "./state/mesh-assets";
import {
  selectIsDirty,
  selectUnit,
  selectVoxels,
  selectWindowTitle,
} from "./state/selectors";
import type { UnitSchematic, VoxelMap } from "./types";

/**
 * Child of Light Editor - root shell.
 *
 * Three-pane layout per docs/editor-app-tauri-brief.md:
 *   - Left: Mesh workspace (template gallery + Three.js viewer + voxelizer)
 *   - Center: Attribute form (physical inputs only, per DESIGN.md Principle 2)
 *   - Right: Battlefield preview (top-down Three.js, TA-style camera)
 *
 * All three panes consume the shared UnitState via the React Context
 * provider defined in src/state. App owns the side-effects: window
 * title, autosave timer, before-unload guard, and autosave recovery banner.
 * Pure rendering and state mutation live elsewhere.
 */

/** Shape of the JSON envelope written by the autosave job. */
interface AutosaveEnvelope {
  readonly _autosave: true;
  readonly savedAt: string;
  readonly sourcePath: string | null;
  readonly sessionId: string;
  readonly unit: UnitSchematic;
}

function isAutosaveEnvelope(v: unknown): v is AutosaveEnvelope {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>)["_autosave"] === true &&
    typeof (v as Record<string, unknown>)["savedAt"] === "string" &&
    typeof (v as Record<string, unknown>)["unit"] === "object"
  );
}

function AppShell() {
  const { state, dispatch } = useUnitState();

  // Live selectors - recomputed each render, free.
  const unit: UnitSchematic = selectUnit(state);
  const voxels: VoxelMap = selectVoxels(state);
  const isDirty = selectIsDirty(state);
  const windowTitle = selectWindowTitle(state);

  // Status notice surfaced by MenuBar (save errors, etc.).
  const [notice, setNotice] = useState<string | null>(null);

  // Autosave recovery — non-null while the banner is visible.
  const [recoverData, setRecoverData] = useState<AutosaveEnvelope | null>(null);

  // --- Pane callbacks: thin wrappers around dispatch ---------------------

  const handleVoxelsChange = useCallback(
    (next: VoxelMap) => {
      dispatch({ type: "SetVoxels", voxels: next });
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

  // Store this session's autosave path in localStorage so the next
  // session can offer recovery without needing its own sessionId.
  useEffect(() => {
    void getAutosavePath(state.sessionId).then((p) => {
      localStorage.setItem("col_last_autosave", p);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally once — sessionId never changes mid-session

  // --- Autosave recovery banner (runs once on mount) --------------------
  useEffect(() => {
    const savedPath = localStorage.getItem("col_last_autosave");
    if (!savedPath) return;
    invoke<string>("read_unit_file", { path: savedPath })
      .then((raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        if (isAutosaveEnvelope(parsed)) {
          setRecoverData(parsed);
        }
      })
      .catch(() => {
        // No autosave file found — nothing to offer.
      });
  }, []);

  // --- Recovery banner handlers -----------------------------------------
  const handleRestore = useCallback(() => {
    if (!recoverData) return;
    dispatch({ type: "SetUnit", unit: recoverData.unit });
    setRecoverData(null);
  }, [dispatch, recoverData]);

  const handleDismissRecover = useCallback(() => {
    setRecoverData(null);
  }, []);

  const overflowHidden: React.CSSProperties = { overflow: "hidden" };

  return (
    <div className="app-shell">
      <header className="app-header">
        <MenuBar notice={notice} setNotice={setNotice} />
        {recoverData !== null && (
          <div className="autosave-banner" role="alert">
            <span>
              {"Autosave found from "}
              {new Date(recoverData.savedAt).toLocaleString()}
              {". Restore?"}
            </span>
            <button type="button" onClick={handleRestore}>
              Restore
            </button>
            <button type="button" onClick={handleDismissRecover}>
              Dismiss
            </button>
          </div>
        )}
      </header>
      <main className="workspace">
        <section className="pane pane-left" aria-label="Mesh workspace">
          <div className="pane-header">Mesh Workspace</div>
          <div className="pane-body" style={overflowHidden}>
            <MeshWorkspace
              voxels={voxels}
              onVoxelsUpdated={handleVoxelsChange}
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
      <MeshAssetProvider>
        <AppShell />
      </MeshAssetProvider>
    </UnitStateProvider>
  );
}

export default App;
