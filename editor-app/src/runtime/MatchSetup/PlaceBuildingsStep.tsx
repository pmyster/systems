/**
 * PlaceBuildingsStep — Phase 2 Stage 1
 *
 * Match Setup's NEW third step (after Pick Map + Pick Units, before Load
 * Match). Renders a top-down view of the loaded map and lets the user
 * drop building tokens at world coordinates with a faction + rotation.
 *
 * State shape:
 *   - placements: readonly BuildingPlacement[] — what the user has
 *     dropped so far. Source of truth for the rest of the match-load
 *     pipeline.
 *   - selectedClass: which palette item is currently armed for placement.
 *   - selectedFaction: which team the next-placed building joins.
 *   - selectedIdx | null: highlight + edit handle for an existing
 *     placement (delete + rotation controls).
 *
 * Top-down rendering:
 *   - The heightmap is drawn into a <canvas> as a grayscale image.
 *     Min-height → black, max-height → white. No splatmap/colorpaint
 *     overlay v1 — the building tokens carry all the visual signal.
 *   - Click coords are translated from canvas pixels to world meters
 *     using the loaded map's tileSizeM + dimensions.
 *
 * Defensive patterns (per CLAUDE.md "Unknown Data Must Be Visible"):
 *   - Off-map drop → loud warn + clamp into bounds.
 *   - Steep-slope drop → loud warn but allow (player intent matters more
 *     than terrain in Stage 1; a 30° slope check is the surfaced check).
 *   - Empty placements → "Load Match" still works (legacy behavior).
 *
 * Visibility / accessibility:
 *   - The palette buttons + faction toggle have aria-pressed.
 *   - The canvas has a focusable role with keyboard arrows reserved for
 *     future fine-positioning (no implementation Stage 1; placeholder).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { LoadedMap } from "../loader/mapLoader";
import {
  type BuildingPlacement,
  clampPlacementToMap,
} from "../BuildingPlacement";
import {
  BUILDING_CHASSIS_CLASSES,
  type BuildingChassisClass,
} from "../../types/unit";
import {
  renderMapTopDownPreview,
  samplePixelVariance,
} from "../scene/MapPreviewRenderer";

export interface PlaceBuildingsStepProps {
  readonly map: LoadedMap;
  readonly placements: readonly BuildingPlacement[];
  readonly onPlacementsChange: (next: readonly BuildingPlacement[]) => void;
}

/** Pixel size of the top-down preview canvas. Stage 1 default 384×384. */
const PREVIEW_PX = 384;

/** Maximum slope (degrees) below which a placement is "safe". */
const SAFE_SLOPE_DEG = 30;

const PALETTE_LABELS: Readonly<Record<BuildingChassisClass, string>> = {
  building_turret: "Turret",
  building_wall: "Wall",
  building_aa: "AA Tower",
  building_bunker: "Bunker",
};

/** Per-faction display colour (CSS) for tokens + UI cues. */
const FACTION_COLORS: Readonly<Record<number, string>> = {
  0: "#4a90e2", // team blue
  1: "#e24a4a", // team red
  255: "#999999", // neutral grey (FACTION_NEUTRAL)
};

const FACTION_LABELS: Readonly<Record<number, string>> = {
  0: "Team 0 (blue)",
  1: "Team 1 (red)",
  255: "Neutral",
};

const FACTIONS_AVAILABLE: readonly number[] = [0, 1, 255];

// ---------------------------------------------------------------------------
// Top-down heightmap → grayscale canvas data.
// ---------------------------------------------------------------------------

/**
 * Build an ImageBitmap-compatible Uint8ClampedArray from the heightmap.
 * Each pixel is a grayscale brightness derived from the height value:
 *   low height → near black; high height → near white.
 *
 * Pure function — no canvas access, no DOM — so unit tests can call it
 * directly without a jsdom canvas mock.
 */
export function heightmapToGrayscale(
  heightmap: Float32Array,
  widthPx: number,
  heightPx: number,
): Uint8ClampedArray {
  if (heightmap.length !== widthPx * heightPx) {
    throw new Error(
      `heightmapToGrayscale: array length ${heightmap.length} does not match ${widthPx}×${heightPx} = ${widthPx * heightPx}.`,
    );
  }
  // Find min/max for normalization. A flat map maps to mid-grey.
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0; i < heightmap.length; i++) {
    const h = heightmap[i];
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  const range = maxH - minH;
  const out = new Uint8ClampedArray(widthPx * heightPx * 4);
  for (let i = 0; i < heightmap.length; i++) {
    // Avoid divide-by-zero on a perfectly flat map.
    const n = range > 1e-6 ? (heightmap[i] - minH) / range : 0.5;
    const g = Math.floor(n * 255);
    out[i * 4 + 0] = g;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Sample the local slope (degrees) under a world-meter position. Uses
 * finite differences across one tile width. Returns 0 on out-of-bounds
 * (defensive — bounds check happens elsewhere).
 */
export function sampleSlopeDeg(
  heightmap: Float32Array,
  widthPx: number,
  heightPx: number,
  tileSizeM: number,
  worldX: number,
  worldZ: number,
): number {
  const cx = Math.floor(worldX / tileSizeM);
  const cz = Math.floor(worldZ / tileSizeM);
  if (cx < 0 || cx >= widthPx - 1 || cz < 0 || cz >= heightPx - 1) return 0;
  const h00 = heightmap[cz * widthPx + cx];
  const hX1 = heightmap[cz * widthPx + (cx + 1)];
  const hZ1 = heightmap[(cz + 1) * widthPx + cx];
  // dh/dx and dh/dz in meters per meter. Max slope = max magnitude.
  const dx = (hX1 - h00) / tileSizeM;
  const dz = (hZ1 - h00) / tileSizeM;
  const maxGrad = Math.sqrt(dx * dx + dz * dz);
  return Math.atan(maxGrad) * (180 / Math.PI);
}

// ---------------------------------------------------------------------------
// Pixel ↔ world conversion (pure, exported for tests).
//
// Convention recap (see the on-click handler for the full comment block):
//   - Origin at world (0,0) maps to canvas (0,0) (top-left corner).
//   - +X → right in the image; +Z → down in the image.
//   - mapWm = (widthPx - 1) * tileM (corner-sampled heightmap).
//   - Click coords are normalized to fractional 0..1 using the canvas
//     bounding-rect dimensions so any CSS scaling is invisible to the
//     conversion.
// ---------------------------------------------------------------------------

/**
 * Convert a fractional canvas position (0..1 in each axis) to a world
 * (x, z) tuple. Pure — exported for round-trip + corner-coverage tests.
 */
export function canvasFractionToWorld(
  fx: number,
  fy: number,
  mapWidthM: number,
  mapDepthM: number,
): readonly [number, number] {
  return [fx * mapWidthM, fy * mapDepthM] as const;
}

/**
 * Convert a world (x, z) to a fractional canvas position (0..1 in each
 * axis). Inverse of `canvasFractionToWorld`. Pure — exported for
 * round-trip tests.
 *
 * Guards against div-by-zero on a degenerate 1×1 heightmap (mapWidthM
 * or mapDepthM = 0): returns 0 for that axis, since "fraction of zero
 * width" has no meaningful answer.
 */
export function worldToCanvasFraction(
  worldX: number,
  worldZ: number,
  mapWidthM: number,
  mapDepthM: number,
): readonly [number, number] {
  const fx = mapWidthM > 0 ? worldX / mapWidthM : 0;
  const fy = mapDepthM > 0 ? worldZ / mapDepthM : 0;
  return [fx, fy] as const;
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function PlaceBuildingsStep(
  props: PlaceBuildingsStepProps,
): React.JSX.Element {
  const { map, placements, onPlacementsChange } = props;

  const tileM = map.manifest.terrain.tileSizeM ?? 1;
  // World extent of the rendered terrain. Must match RuntimeTerrain and
  // MapPreviewRenderer.buildPreviewTerrainMesh — both use (px-1)*tileM,
  // NOT px*tileM. A 513×513 heightmap at tileM=1 occupies world meters
  // [0, 512] × [0, 512] (the heightmap stores corner samples, hence
  // px-1 spans between them). Using widthPx*tileM here would silently
  // map clicks to world coords ~1 tile beyond the actual terrain edge,
  // and the spawned building would sit just outside the playable zone.
  const mapWm = (map.manifest.terrain.widthPx - 1) * tileM;
  const mapDm = (map.manifest.terrain.heightPx - 1) * tileM;

  const [selectedClass, setSelectedClass] =
    useState<BuildingChassisClass>("building_turret");
  const [selectedFaction, setSelectedFaction] = useState<number>(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Preview is a top-down 3D render of the actual map — biome colors,
  // sun-lit elevation, water — generated once per map via
  // MapPreviewRenderer. The grayscale fallback path inside that module
  // handles WebGL-unavailable environments (tests, lost context).
  //
  // We render at 1024×1024 (the renderer's default) and draw it scaled
  // into the PREVIEW_PX canvas — sharper than rendering directly at
  // PREVIEW_PX, gives the user a crisp image even at the small panel
  // size, and the placement coordinate math operates off PREVIEW_PX so
  // pixel↔meter conversion is unchanged.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    renderMapTopDownPreview(map, 1024, {
      add: (msg) => {
        // Surface the fallback warning in the diagnostic chip — the user
        // sees "preview fell back to grayscale: <why>" instead of a
        // silently-degraded image.
        if (!cancelled) setPreviewError(msg);
      },
    })
      .then((url) => {
        if (!cancelled) {
          setPreviewUrl(url);
          setPreviewLoading(false);
        }
      })
      .catch((e: unknown) => {
        // renderMapTopDownPreview already handles its own failures (it
        // catches and falls back). A throw here means *both* paths
        // failed — extremely unusual. Surface loudly.
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setPreviewError(`preview failed: ${msg}`);
          setPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [map]);

  // When the data URL arrives, paint it into the canvas at PREVIEW_PX
  // size. We draw via Image so the canvas's 2D context handles the
  // scale, matching the prior grayscale path.
  //
  // After painting, we read the rendered pixels back and run a variance
  // check (per CLAUDE.md "Unknown Data Must Be Visible"): if the preview
  // is suspiciously uniform — every sampled pixel within ~2 LSB of the
  // mean — surface a chip warning. This catches the silent
  // "renders but produces gray" failure mode that the 3D path can
  // sometimes hit without throwing (e.g. lost WebGL context, flipped
  // frustum, empty biome data).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewUrl) return;
    canvas.width = PREVIEW_PX;
    canvas.height = PREVIEW_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, PREVIEW_PX, PREVIEW_PX);
      ctx.drawImage(img, 0, 0, PREVIEW_PX, PREVIEW_PX);
      // Sanity check the painted result. Wrapped in a try because in
      // headless test environments getImageData can throw on a tainted
      // canvas (it never will here — the data URL came from us — but
      // the defensive try keeps us out of the way).
      try {
        const imgData = ctx.getImageData(0, 0, PREVIEW_PX, PREVIEW_PX);
        const variance = samplePixelVariance(imgData.data, PREVIEW_PX);
        if (variance.maxStdDev < 2.0) {
          setPreviewError(
            `preview image is suspiciously uniform ` +
              `(stddev ${variance.maxStdDev.toFixed(1)} < 2, ` +
              `mean RGB ${variance.meanR.toFixed(0)}/${variance.meanG.toFixed(0)}/${variance.meanB.toFixed(0)}). ` +
              `Likely a lighting or biome-data bug in MapPreviewRenderer — F12 console for details.`,
          );
        }
      } catch {
        // jsdom / canvas-package-missing environments: skip silently —
        // the renderer's own variance check still surfaces in
        // console.warn. Production browsers always succeed here.
      }
    };
    img.src = previewUrl;
  }, [previewUrl]);

  // -----------------------------------------------------------------
  // PIXEL ↔ WORLD coordinate conversion for PlaceBuildings.
  //
  // The preview renders the map with:
  //   - World origin (0, 0, 0) at the TOP-LEFT corner of the rendered
  //     image — NOT the map center. Matches RuntimeTerrain, which
  //     anchors the terrain mesh at world (0..widthM, 0..depthM).
  //   - X axis: +X is RIGHT in the rendered image (image-x grows right
  //     ⇒ world +X grows right).
  //   - Z axis: +Z is DOWN in the rendered image (per d52c104:
  //     camera.up = (0,0,-1) combined with top > bottom puts world +Z
  //     at image-bottom, i.e. screen-Y grows down ⇒ world +Z grows
  //     down). NO Y-axis flip is required at the conversion layer.
  //   - Image dimensions: rendered at 1024×1024 px, displayed at
  //     `canvas.clientWidth` × `canvas.clientHeight` (which equals
  //     PREVIEW_PX in normal layout but may differ under CSS scaling,
  //     hi-DPI rendering, or responsive flex shrink — so we use the
  //     displayed-pixel basis as the source of truth, not PREVIEW_PX).
  //
  // World extent: (widthPx-1)*tileM × (heightPx-1)*tileM — see mapWm
  // above. Heightmap samples are at corners, so n samples span n-1
  // tile lengths.
  //
  // Therefore (with `rect` = canvas.getBoundingClientRect()):
  //   worldX = ((clientX - rect.left) / rect.width)  * mapWm
  //   worldZ = ((clientY - rect.top)  / rect.height) * mapDm
  //
  // Inverse (for token overlay rendering — the overlay is sized to the
  // SAME displayed dimensions as the canvas, so PREVIEW_PX is fine):
  //   px = (worldX / mapWm) * PREVIEW_PX
  //   py = (worldZ / mapDm) * PREVIEW_PX
  // -----------------------------------------------------------------

  // Convert a FRACTIONAL canvas position (0..1 in each axis) to a
  // world (x, z) tuple. The caller is responsible for normalizing the
  // raw click coords using the canvas's bounding-rect dimensions —
  // this keeps the conversion robust to CSS scaling, browser zoom, or
  // any future responsive layout that shrinks the canvas display.
  // Delegates to the pure `canvasFractionToWorld` so the on-click path
  // and the placeBuildings.test.ts tests share ONE conversion impl.
  const fractionalToWorld = useCallback(
    (fx: number, fy: number): readonly [number, number] =>
      canvasFractionToWorld(fx, fy, mapWm, mapDm),
    [mapWm, mapDm],
  );

  // Convert a world coord to a canvas pixel for token rendering. The
  // SVG overlay matches the canvas's PREVIEW_PX dimensions exactly, so
  // we multiply the fractional result by PREVIEW_PX. Same pure helper
  // → tests cover the inverse direction too.
  const worldToCanvas = useCallback(
    (wx: number, wz: number): readonly [number, number] => {
      const [fx, fy] = worldToCanvasFraction(wx, wz, mapWm, mapDm);
      return [fx * PREVIEW_PX, fy * PREVIEW_PX] as const;
    },
    [mapWm, mapDm],
  );

  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      // Normalize click into 0..1 fractional space using the DISPLAYED
      // canvas dimensions, not the internal buffer size. This is the
      // load-bearing line: `clientX/Y` are in CSS pixels, and
      // `rect.width/height` is the canvas's CSS size — so the ratio is
      // resolution-independent and survives any CSS scaling or
      // hi-DPI/device-pixel-ratio quirks. Guard against a zero-size
      // rect (defensive; shouldn't happen but a div:0 here would
      // silently place at world (NaN, NaN)).
      const rectW = rect.width > 0 ? rect.width : PREVIEW_PX;
      const rectH = rect.height > 0 ? rect.height : PREVIEW_PX;
      const fx = (e.clientX - rect.left) / rectW;
      const fy = (e.clientY - rect.top) / rectH;
      // Canvas-space pixel coords (in PREVIEW_PX basis) for token
      // hit-testing against the SVG overlay, which is sized at
      // PREVIEW_PX.
      const px = fx * PREVIEW_PX;
      const py = fy * PREVIEW_PX;
      const [wx, wz] = fractionalToWorld(fx, fy);

      // First check if the click hit an existing token (within 16 canvas
      // px). Selects it for edit rather than placing a new one.
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        const [tx, ty] = worldToCanvas(p.position_xz[0], p.position_xz[1]);
        const dx = tx - px;
        const dy = ty - py;
        if (dx * dx + dy * dy < 16 * 16) {
          setSelectedIdx(i);
          setDiagnostic(null);
          return;
        }
      }

      // Otherwise place a new token. Clamp to bounds + diagnostic.
      const { position, wasClamped } = clampPlacementToMap([wx, wz], mapWm, mapDm);
      const slope = sampleSlopeDeg(
        map.heightmap,
        map.manifest.terrain.widthPx,
        map.manifest.terrain.heightPx,
        tileM,
        position[0],
        position[1],
      );
      const messages: string[] = [];
      if (wasClamped) {
        messages.push(
          `clamped from (${wx.toFixed(1)}, ${wz.toFixed(1)}) to (${position[0].toFixed(1)}, ${position[1].toFixed(1)}) — within map bounds`,
        );
      }
      if (slope > SAFE_SLOPE_DEG) {
        messages.push(
          `slope ${slope.toFixed(1)}° exceeds ${SAFE_SLOPE_DEG}° threshold — placed anyway, but the building may look tilted`,
        );
      }
      setDiagnostic(messages.length > 0 ? messages.join("; ") : null);

      const next: BuildingPlacement = {
        chassis_class: selectedClass,
        position_xz: position,
        rotation_y: 0,
        faction: selectedFaction,
      };
      onPlacementsChange([...placements, next]);
      setSelectedIdx(placements.length); // newly added → last index
    },
    [
      placements,
      onPlacementsChange,
      selectedClass,
      selectedFaction,
      fractionalToWorld,
      worldToCanvas,
      map,
      mapWm,
      mapDm,
      tileM,
    ],
  );

  const onDelete = useCallback(() => {
    if (selectedIdx === null) return;
    const next = placements.filter((_, i) => i !== selectedIdx);
    onPlacementsChange(next);
    setSelectedIdx(null);
  }, [selectedIdx, placements, onPlacementsChange]);

  const onRotationChange = useCallback(
    (deg: number) => {
      if (selectedIdx === null) return;
      const rad = (deg * Math.PI) / 180;
      const next = placements.map((p, i) =>
        i === selectedIdx ? { ...p, rotation_y: rad } : p,
      );
      onPlacementsChange(next);
    },
    [selectedIdx, placements, onPlacementsChange],
  );

  const onClearAll = useCallback(() => {
    onPlacementsChange([]);
    setSelectedIdx(null);
    setDiagnostic(null);
  }, [onPlacementsChange]);

  const selected = selectedIdx !== null ? placements[selectedIdx] : null;

  return (
    <div style={ROOT_STYLE} aria-label="Place Buildings step">
      <div style={ROW_STYLE}>
        <div style={SECTION_STYLE}>
          <div style={LABEL_STYLE}>Building:</div>
          {BUILDING_CHASSIS_CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={selectedClass === c}
              onClick={() => setSelectedClass(c)}
              style={{
                ...PALETTE_BUTTON_STYLE,
                background:
                  selectedClass === c ? "#2d6e3a" : PALETTE_BUTTON_STYLE.background,
              }}
            >
              {PALETTE_LABELS[c]}
            </button>
          ))}
        </div>

        <div style={SECTION_STYLE}>
          <div style={LABEL_STYLE}>Faction:</div>
          {FACTIONS_AVAILABLE.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={selectedFaction === f}
              onClick={() => setSelectedFaction(f)}
              style={{
                ...PALETTE_BUTTON_STYLE,
                background:
                  selectedFaction === f ? FACTION_COLORS[f] : PALETTE_BUTTON_STYLE.background,
                color: selectedFaction === f ? "#0d0f14" : "#e8eef5",
              }}
            >
              {FACTION_LABELS[f]}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClearAll}
          disabled={placements.length === 0}
          style={SECONDARY_BUTTON_STYLE}
        >
          Clear All
        </button>
      </div>

      <div style={ROW_STYLE}>
        <div style={CANVAS_WRAP_STYLE}>
          <canvas
            ref={canvasRef}
            width={PREVIEW_PX}
            height={PREVIEW_PX}
            onClick={onCanvasClick}
            style={CANVAS_STYLE}
            aria-label="Top-down map preview — click to place buildings"
          />
          {previewLoading && (
            <div style={LOADING_OVERLAY_STYLE} role="status">
              Rendering map preview…
            </div>
          )}
          {/* Render token overlay */}
          <svg
            width={PREVIEW_PX}
            height={PREVIEW_PX}
            style={OVERLAY_STYLE}
            aria-hidden="true"
          >
            {placements.map((p, i) => {
              const [px, py] = worldToCanvas(
                p.position_xz[0],
                p.position_xz[1],
              );
              const isSel = i === selectedIdx;
              const col = FACTION_COLORS[p.faction] ?? "#cccccc";
              return (
                <g key={i}>
                  <circle
                    cx={px}
                    cy={py}
                    r={isSel ? 11 : 8}
                    fill={col}
                    stroke={isSel ? "#fff" : "#000"}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  <text
                    x={px}
                    y={py + 3}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight="bold"
                    fill="#000"
                  >
                    {p.chassis_class === "building_turret"
                      ? "T"
                      : p.chassis_class === "building_wall"
                        ? "W"
                        : p.chassis_class === "building_aa"
                          ? "A"
                          : "B"}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div style={SIDE_PANEL_STYLE}>
          <div style={CHIP_STYLE}>
            Placements: <b>{placements.length}</b>
          </div>
          <div style={CHIP_STYLE}>
            Map: {mapWm.toFixed(0)} × {mapDm.toFixed(0)} m
          </div>
          {previewError && (
            <div style={WARN_STYLE} role="status">
              Preview fell back to grayscale: {previewError}
            </div>
          )}
          {selected ? (
            <div style={EDITOR_PANEL_STYLE}>
              <div style={LABEL_STYLE}>
                Selected: #{selectedIdx}
              </div>
              <div style={CHIP_STYLE}>
                {PALETTE_LABELS[selected.chassis_class]} ·{" "}
                {FACTION_LABELS[selected.faction]}
              </div>
              <div style={CHIP_STYLE}>
                Pos: ({selected.position_xz[0].toFixed(1)},{" "}
                {selected.position_xz[1].toFixed(1)})
              </div>
              <div style={ROW_INLINE_STYLE}>
                <label style={LABEL_STYLE}>Yaw (deg):</label>
                <input
                  type="number"
                  min={0}
                  max={359}
                  step={5}
                  value={Math.round((selected.rotation_y * 180) / Math.PI)}
                  onChange={(e) => onRotationChange(Number(e.target.value))}
                  style={INPUT_STYLE}
                  aria-label="Rotation degrees"
                />
              </div>
              <button type="button" onClick={onDelete} style={DANGER_BUTTON_STYLE}>
                Delete
              </button>
            </div>
          ) : (
            <div style={MUTED_STYLE}>
              Click the map to place a building. Click an existing token to
              edit or delete.
            </div>
          )}
          {diagnostic && (
            <div style={WARN_STYLE} role="status">
              {diagnostic}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles (inline, matching the rest of MatchSetupScreen).
// ---------------------------------------------------------------------------

const ROOT_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 8,
  border: "1px solid #2a2e38",
  borderRadius: 4,
  background: "#11141b",
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 12,
};

const ROW_INLINE_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const SECTION_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const LABEL_STYLE: React.CSSProperties = {
  color: "#9aa3b0",
  marginRight: 4,
};

const PALETTE_BUTTON_STYLE: React.CSSProperties = {
  padding: "5px 10px",
  background: "#2a3242",
  color: "#e8eef5",
  border: "1px solid #3a4252",
  borderRadius: 3,
  cursor: "pointer",
  font: "12px ui-monospace, monospace",
};

const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  padding: "5px 10px",
  background: "#3a2d2a",
  color: "#e8eef5",
  border: "1px solid #6e3a3a",
  borderRadius: 3,
  cursor: "pointer",
  font: "12px ui-monospace, monospace",
};

const DANGER_BUTTON_STYLE: React.CSSProperties = {
  padding: "6px 12px",
  background: "#3a1a1a",
  color: "#ffb0b0",
  border: "1px solid #6e2d2d",
  borderRadius: 3,
  cursor: "pointer",
};

const CANVAS_WRAP_STYLE: React.CSSProperties = {
  position: "relative",
  width: PREVIEW_PX,
  height: PREVIEW_PX,
};

const CANVAS_STYLE: React.CSSProperties = {
  background: "#000",
  border: "1px solid #2a2e38",
  display: "block",
  cursor: "crosshair",
};

const OVERLAY_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  pointerEvents: "none",
};

const LOADING_OVERLAY_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: PREVIEW_PX,
  height: PREVIEW_PX,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(13,15,20,0.7)",
  color: "#e8eef5",
  font: "12px ui-monospace, monospace",
  pointerEvents: "none",
};

const SIDE_PANEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 220,
};

const EDITOR_PANEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 8,
  background: "#161a22",
  border: "1px solid #2a2e38",
  borderRadius: 3,
};

const CHIP_STYLE: React.CSSProperties = {
  padding: "3px 8px",
  background: "#161a22",
  border: "1px solid #2a2e38",
  borderRadius: 3,
  color: "#9aa3b0",
};

const MUTED_STYLE: React.CSSProperties = {
  color: "#7a8390",
  fontStyle: "italic",
  padding: 4,
};

const INPUT_STYLE: React.CSSProperties = {
  width: 60,
  padding: "3px 6px",
  background: "#0d0f14",
  color: "#e8eef5",
  border: "1px solid #2a2e38",
  borderRadius: 3,
  font: "inherit",
};

const WARN_STYLE: React.CSSProperties = {
  padding: "6px 8px",
  background: "#3a341a",
  border: "1px solid #6e612d",
  borderRadius: 3,
  color: "#fff0b0",
  fontSize: 11,
};
