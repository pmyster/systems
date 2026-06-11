/**
 * Tool selector + scene-toggle UI for the Voxel Sculptor.
 *
 * The prototype's toolbar (tools/voxel-editor/index.html lines 116-121,
 * 138-146) exposed: Clear, Mirror-X, Show Grid, Show Build Region,
 * Load, Save. Load/Save in the new Tauri shell live at the App level;
 * everything else is per-pane and surfaces here.
 *
 * Tool-mode (Add / Remove / Eraser) is not strictly part of the
 * prototype (left-click adds, right-click removes), but the brief asks
 * for an explicit selector — useful on touchscreens and for keyboard
 * users. The selector is informational for now: the pointer hook still
 * keys off mouse-button as the primary signal, and the selector
 * default is Add.
 */

import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// Tool enum.
// ---------------------------------------------------------------------------

export type ToolMode = "add" | "remove";

// ---------------------------------------------------------------------------
// Props.
// ---------------------------------------------------------------------------

export interface ToolsProps {
  readonly tool: ToolMode;
  readonly onToolChange: (tool: ToolMode) => void;

  readonly mirrorX: boolean;
  readonly onMirrorChange: (mirror: boolean) => void;

  readonly showGrid: boolean;
  readonly onShowGridChange: (visible: boolean) => void;

  readonly showRegion: boolean;
  readonly onShowRegionChange: (visible: boolean) => void;

  readonly onClear: () => void;
  readonly voxelCount: number;
}

// ---------------------------------------------------------------------------
// Styles.
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  row: {
    display: "flex",
    gap: 4,
    flexWrap: "wrap",
  },
  btn: {
    background: "#232831",
    color: "#d8dde6",
    border: "1px solid #3a4150",
    padding: "5px 10px",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "inherit",
  },
  btnActive: {
    background: "#6b8eb3",
    borderColor: "#6b8eb3",
    color: "#fff",
  },
  btnDanger: {
    background: "transparent",
    color: "#d97670",
    borderColor: "#d97670",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 0",
    cursor: "pointer",
    fontSize: 12,
    color: "#d8dde6",
  },
  sectionLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#8a93a3",
    fontWeight: 600,
    margin: "4px 0 2px",
  },
};

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function Tools(props: ToolsProps) {
  const {
    tool,
    onToolChange,
    mirrorX,
    onMirrorChange,
    showGrid,
    onShowGridChange,
    showRegion,
    onShowRegionChange,
    onClear,
    voxelCount,
  } = props;

  const toolBtn = (mode: ToolMode, label: string) => (
    <button
      type="button"
      style={{ ...styles.btn, ...(tool === mode ? styles.btnActive : null) }}
      onClick={() => onToolChange(mode)}
    >
      {label}
    </button>
  );

  const handleClear = (): void => {
    if (voxelCount === 0) return;
    // Native confirm() exists in Tauri's webview; mirrors the prototype's
    // safety prompt (tools/voxel-editor/index.html line 577).
    if (window.confirm("Clear all voxels?")) onClear();
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.sectionLabel}>Tool</div>
      <div style={styles.row}>
        {toolBtn("add", "Add")}
        {toolBtn("remove", "Remove")}
      </div>

      <div style={styles.sectionLabel}>Symmetry</div>
      <div style={styles.row}>
        <button
          type="button"
          style={{ ...styles.btn, ...(mirrorX ? styles.btnActive : null) }}
          onClick={() => onMirrorChange(!mirrorX)}
          aria-pressed={mirrorX}
        >
          Mirror X
        </button>
      </div>

      <div style={styles.sectionLabel}>View</div>
      <label style={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={showGrid}
          onChange={(e) => onShowGridChange(e.target.checked)}
        />
        Show grid
      </label>
      <label style={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={showRegion}
          onChange={(e) => onShowRegionChange(e.target.checked)}
        />
        Show build region
      </label>

      <div style={styles.sectionLabel}>Actions</div>
      <div style={styles.row}>
        <button
          type="button"
          style={{ ...styles.btn, ...styles.btnDanger }}
          onClick={handleClear}
          disabled={voxelCount === 0}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
