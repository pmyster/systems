/**
 * MatchSetupScreen — Phase 1 Week 1B
 *
 * The Play tab's new entry point: ask the user for a map directory + a
 * list of unit Schematic JSON paths, then run the 5-phase MatchLoader.
 * On completion, invoke the parent's `onLoaded` callback which mounts the
 * runtime scene (terrain + physics + InstancedUnitRenderer with 0 entities).
 *
 * The UI is intentionally bare — three buttons + a progress bar + an error
 * pane. Polish (recent matches, validation chips, presets) is deferred. The
 * goal of this slice is "I can prove the pipeline works."
 *
 * Defensive patterns honoured here:
 *   - Dialog cancellations don't disable the buttons (user can re-pick)
 *   - Load failures surface verbatim in the error pane (no silent reset)
 *   - The "Load Match" button is disabled until both picks exist
 */

import { useCallback, useState } from "react";

import {
  pickAndLoadMap,
  loadMapFromDir,
  type LoadedMap,
} from "./loader/mapLoader";
import { pickAndLoadSchematics } from "./loader/schematicLoader";
import { MatchLoader, type LoadProgress, type MatchData } from "./MatchLoader";

export interface MatchSetupScreenProps {
  /** Called once the loader finishes; the parent mounts the runtime scene. */
  readonly onLoaded: (data: MatchData) => void;
}

export function MatchSetupScreen(
  props: MatchSetupScreenProps,
): React.JSX.Element {
  const { onLoaded } = props;

  // We keep `mapDir` (the path) separately from `mapPreview` (the parsed
  // result of the picker invocation) so the user can pick a map without
  // immediately loading it again at click-Load time. We DO re-load the map
  // inside the MatchLoader so the load sequence is single-threaded — the
  // first parse is just a sanity check.
  const [mapDir, setMapDir] = useState<string | null>(null);
  const [mapPreview, setMapPreview] = useState<LoadedMap | null>(null);

  // Schematic paths are tracked; their parsed forms are re-read inside the
  // loader so the progress bar reflects the actual load work.
  const [schematicPaths, setSchematicPaths] = useState<readonly string[]>([]);

  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPickMap = useCallback(async () => {
    setError(null);
    try {
      const loaded = await pickAndLoadMap();
      if (loaded === null) return; // user cancelled
      setMapDir(loaded.dir);
      setMapPreview(loaded);
    } catch (e) {
      // Surface the error verbatim — never silently reset.
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Map pick failed: ${msg}`);
    }
  }, []);

  const onPickSchematics = useCallback(async () => {
    setError(null);
    try {
      const loaded = await pickAndLoadSchematics();
      // We store the paths; the parsed forms returned here are discarded
      // because the loader re-reads them during phase 3.
      setSchematicPaths(loaded.map((s) => s.path));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Schematic pick failed: ${msg}`);
    }
  }, []);

  const onLoadMatch = useCallback(async () => {
    if (!mapDir) return;
    setError(null);
    setBusy(true);
    setProgress({ phase: "manifest", progress: 0, message: "Starting…" });
    try {
      // Sanity re-load the map by path. Avoids drift in case the user
      // re-picked schematics without re-picking the map.
      await loadMapFromDir(mapDir);
      const loader = new MatchLoader();
      const data = await loader.load(mapDir, schematicPaths, (p) => {
        setProgress(p);
      });
      onLoaded(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Match load failed: ${msg}`);
      setBusy(false);
    }
  }, [mapDir, schematicPaths, onLoaded]);

  const canLoad = mapDir !== null && !busy;

  return (
    <div style={ROOT_STYLE} aria-label="Match Setup">
      <h1 style={TITLE_STYLE}>Set Up Match</h1>
      <p style={SUBTITLE_STYLE}>Phase 1 Week 1B — Map + Unit set + load</p>

      <section style={SECTION_STYLE}>
        <button type="button" onClick={onPickMap} disabled={busy} style={BUTTON_STYLE}>
          Pick Map…
        </button>
        <div style={CHIP_STYLE}>
          {mapPreview
            ? `${mapPreview.manifest.name} (${mapPreview.manifest.terrain.widthPx}×${mapPreview.manifest.terrain.heightPx})`
            : mapDir
              ? mapDir
              : "no map picked"}
        </div>
      </section>

      <section style={SECTION_STYLE}>
        <button
          type="button"
          onClick={onPickSchematics}
          disabled={busy}
          style={BUTTON_STYLE}
        >
          Pick Units…
        </button>
        <div style={CHIP_STYLE}>
          {schematicPaths.length === 0
            ? "no units picked (terrain only)"
            : `${schematicPaths.length} unit Schematic${schematicPaths.length === 1 ? "" : "s"}`}
        </div>
      </section>

      <section style={SECTION_STYLE}>
        <button
          type="button"
          onClick={onLoadMatch}
          disabled={!canLoad}
          style={{
            ...BUTTON_STYLE,
            background: canLoad ? "#2d6e3a" : "#1a3a25",
            opacity: canLoad ? 1 : 0.6,
          }}
        >
          {busy ? "Loading…" : "Load Match"}
        </button>
      </section>

      {progress !== null && (
        <section style={SECTION_STYLE} aria-label="Load progress">
          <div style={PROGRESS_TRACK_STYLE}>
            <div
              style={{
                ...PROGRESS_FILL_STYLE,
                width: `${Math.round(progress.progress * 100)}%`,
              }}
            />
          </div>
          <div style={PROGRESS_LABEL_STYLE}>
            {progress.phase}: {progress.message ?? ""} ({Math.round(progress.progress * 100)}%)
          </div>
        </section>
      )}

      {error !== null && (
        <section style={ERROR_STYLE} role="alert">
          {error}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles — same convention as GameRuntime; nothing thread-worthy yet.
// ---------------------------------------------------------------------------

const ROOT_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "#0d0f14",
  color: "#cfd8e3",
  font: "13px ui-monospace, SFMono-Regular, Menlo, monospace",
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  overflow: "auto",
};

const TITLE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 600,
  color: "#e8eef5",
};

const SUBTITLE_STYLE: React.CSSProperties = {
  margin: 0,
  marginBottom: 12,
  color: "#7a8390",
};

const SECTION_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: "8px 14px",
  background: "#2a3242",
  color: "#e8eef5",
  border: "1px solid #3a4252",
  borderRadius: 3,
  font: "inherit",
  cursor: "pointer",
  minWidth: 160,
};

const CHIP_STYLE: React.CSSProperties = {
  padding: "4px 8px",
  background: "#161a22",
  border: "1px solid #2a2e38",
  borderRadius: 3,
  color: "#9aa3b0",
};

const PROGRESS_TRACK_STYLE: React.CSSProperties = {
  width: "100%",
  height: 10,
  background: "#161a22",
  border: "1px solid #2a2e38",
  borderRadius: 3,
  overflow: "hidden",
  maxWidth: 480,
};

const PROGRESS_FILL_STYLE: React.CSSProperties = {
  height: "100%",
  background: "#2d6e3a",
  transition: "width 0.12s ease-out",
};

const PROGRESS_LABEL_STYLE: React.CSSProperties = {
  color: "#9aa3b0",
};

const ERROR_STYLE: React.CSSProperties = {
  padding: "8px 12px",
  background: "#3a1a1a",
  border: "1px solid #6e2d2d",
  borderRadius: 3,
  color: "#ffb0b0",
  maxWidth: 720,
  whiteSpace: "pre-wrap",
};
