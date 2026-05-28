/**
 * MaterialPainter — lets the user drop/upload a painted image and have
 * the system infer material zones automatically via box-projection.
 *
 * Lifecycle:
 *  1. User uploads an image → we read ImageData via an off-screen canvas.
 *  2. inferMaterialsFromImage builds a proposed MaterialId map.
 *  3. A 16×16 preview grid shows proposed zones; clicking a cell cycles
 *     through materials.
 *  4. Apply fires onApply with the current (possibly edited) map.
 */

import React, {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import type { MaterialId, VoxelMap, MutableVoxelMap } from "../../types/voxel";
import { MATERIALS, GRID_SIZE } from "../../lib/constants";
import { inferMaterialsFromImage, hexToRgb } from "./color-inference";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MaterialPainterProps {
  /** The current voxel map — only keys matter; materials will be replaced */
  voxels: VoxelMap;
  /** Called when user clicks Apply with the new material assignments */
  onApply: (updated: MutableVoxelMap) => void;
  /** Called when user clicks Cancel */
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a MATERIALS catalog hex number to a CSS color string. */
function matColorCss(hex: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r},${g},${b})`;
}

/** Index of a MaterialId in the MATERIALS array. -1 if not found. */
function materialIndex(id: MaterialId): number {
  return MATERIALS.findIndex((m) => m.id === id);
}

/** Cycle to the next material in MATERIALS order. */
function cycleMaterial(id: MaterialId): MaterialId {
  const idx = materialIndex(id);
  const next = (idx + 1) % MATERIALS.length;
  return MATERIALS[next].id;
}

/**
 * Read ImageData from a File using an off-screen canvas.
 * The canvas is shrunk to 0×0 and removed after reading (memory hygiene).
 */
function readImageData(file: File): Promise<{ imageData: ImageData; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("FileReader did not produce a string"));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error("Image decode error"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        document.body.appendChild(canvas);
        try {
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Could not get 2D context"));
            return;
          }
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve({ imageData, dataUrl });
        } finally {
          // Memory hygiene — shrink and detach the canvas
          canvas.width = 0;
          canvas.height = 0;
          document.body.removeChild(canvas);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/** Build a summary string like "Hull: 42 · Armor: 18 · …" */
function buildSummary(proposed: MutableVoxelMap): string {
  const counts = new Map<MaterialId, number>();
  for (const id of proposed.values()) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const mat of MATERIALS) {
    const n = counts.get(mat.id);
    if (n !== undefined && n > 0) {
      parts.push(`${mat.name}: ${n}`);
    }
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const DARK_BG = "#0a0d12";
const BORDER_COLOR = "#2a2e38";

const styles = {
  root: {
    background: DARK_BG,
    color: "#e8eaf0",
    fontFamily: "'Share Tech Mono', 'Courier New', monospace",
    fontSize: 13,
    padding: 16,
    borderRadius: 6,
    border: `1px solid ${BORDER_COLOR}`,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minWidth: 280,
  } satisfies CSSProperties,

  heading: {
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "#c8cad4",
    margin: 0,
  } satisfies CSSProperties,

  dropZone: (active: boolean): CSSProperties => ({
    border: `2px dashed ${active ? "#e05050" : BORDER_COLOR}`,
    borderRadius: 4,
    padding: "20px 12px",
    textAlign: "center",
    cursor: "pointer",
    color: active ? "#e05050" : "#66697a",
    transition: "border-color 0.15s, color 0.15s",
    userSelect: "none",
  }),

  thumbnail: {
    maxWidth: 120,
    maxHeight: 120,
    borderRadius: 3,
    border: `1px solid ${BORDER_COLOR}`,
    display: "block",
  } satisfies CSSProperties,

  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(${GRID_SIZE}, 14px)`,
    gap: 1,
  } satisfies CSSProperties,

  cell: (color: string, occupied: boolean): CSSProperties => ({
    width: 14,
    height: 14,
    borderRadius: 2,
    background: occupied ? color : "transparent",
    cursor: occupied ? "pointer" : "default",
    border: occupied ? `1px solid rgba(255,255,255,0.15)` : "1px solid transparent",
    boxSizing: "border-box",
  }),

  summary: {
    color: "#8a8d9a",
    fontSize: 11,
    lineHeight: "1.5",
  } satisfies CSSProperties,

  buttonRow: {
    display: "flex",
    gap: 8,
    marginTop: 4,
  } satisfies CSSProperties,

  button: (variant: "apply" | "cancel"): CSSProperties => ({
    flex: 1,
    padding: "7px 0",
    borderRadius: 3,
    border: "none",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    cursor: "pointer",
    background: variant === "apply" ? "#c0392b" : "#1e2330",
    color: variant === "apply" ? "#fff" : "#8a8d9a",
    transition: "background 0.12s",
  }),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MaterialPainter({
  voxels,
  onApply,
  onCancel,
}: MaterialPainterProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [proposed, setProposed] = useState<MutableVoxelMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- image ingestion ----

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const { imageData, dataUrl } = await readImageData(file);
        const inferred = inferMaterialsFromImage(voxels, imageData, GRID_SIZE);
        setThumbnailUrl(dataUrl);
        setProposed(inferred);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error reading image");
      }
    },
    [voxels],
  );

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      // Reset value so same file can be re-picked
      e.target.value = "";
    },
    [handleFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDropZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // ---- cell cycling ----

  const handleCellClick = useCallback(
    (key: string) => {
      if (!proposed) return;
      const current = proposed.get(key);
      if (current === undefined) return;
      setProposed((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        next.set(key, cycleMaterial(current));
        return next;
      });
    },
    [proposed],
  );

  // ---- apply / cancel ----

  const handleApply = useCallback(() => {
    if (proposed) onApply(proposed);
  }, [proposed, onApply]);

  // ---- render preview grid ----

  // Build a 16×16 matrix of (key | null) so we can render the grid in row-major order
  const gridCells: Array<{ key: string; materialId: MaterialId } | null> = [];
  if (proposed) {
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        // Use x=col, z=row at mid-height (y=GRID_SIZE/2) for the top-down preview slice
        const midY = Math.floor(GRID_SIZE / 2);
        const key = `${col},${midY},${row}`;
        const mat = proposed.get(key);
        gridCells.push(mat !== undefined ? { key, materialId: mat } : null);
      }
    }
  }

  const summary = proposed ? buildSummary(proposed) : "";

  return (
    <div style={styles.root}>
      <p style={styles.heading}>MATERIAL PAINTER</p>

      {/* Drop zone / file picker */}
      <div
        role="button"
        tabIndex={0}
        style={styles.dropZone(dragOver)}
        onClick={handleDropZoneClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleDropZoneClick();
        }}
      >
        Drop image or click to browse
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        style={{ display: "none" }}
        onChange={handleInputChange}
      />

      {error !== null && (
        <p style={{ color: "#e05050", margin: 0, fontSize: 11 }}>{error}</p>
      )}

      {/* Thumbnail */}
      {thumbnailUrl !== null && (
        <img src={thumbnailUrl} alt="Uploaded reference" style={styles.thumbnail} />
      )}

      {/* 16×16 preview grid */}
      {proposed !== null && (
        <>
          <div style={styles.grid}>
            {gridCells.map((cell, idx) => {
              if (cell === null) {
                return (
                  <div
                    key={idx}
                    style={styles.cell("transparent", false)}
                  />
                );
              }
              const matDef = MATERIALS.find((m) => m.id === cell.materialId);
              const color = matDef ? matColorCss(matDef.color) : "#333";
              return (
                <div
                  key={cell.key}
                  title={`${cell.key} → ${cell.materialId}`}
                  style={styles.cell(color, true)}
                  onClick={() => handleCellClick(cell.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleCellClick(cell.key);
                  }}
                />
              );
            })}
          </div>

          {summary.length > 0 && (
            <p style={styles.summary}>{summary}</p>
          )}
        </>
      )}

      {/* Action buttons — always visible */}
      <div style={styles.buttonRow}>
        <button
          style={styles.button("apply")}
          disabled={proposed === null}
          onClick={handleApply}
        >
          APPLY
        </button>
        <button style={styles.button("cancel")} onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
