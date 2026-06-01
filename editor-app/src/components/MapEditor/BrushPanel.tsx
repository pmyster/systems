/**
 * BrushPanel — left rail of the Map Editor. Tool palette + brush controls.
 *
 * Tools: Sculpt / Place / Scatter / Decal / Paint / Select.
 *
 * State source-of-truth lives in `mapStore`. The scene manager listens to
 * the same store so radius changes here reposition the brush decal ring
 * live, and tool changes route input through the right controller.
 */

import { useMapStore, _resetTerrainToFlat } from "../../map/state/mapStore";
import type { MaterialIndex, ToolKind } from "../../map/state/mapStore";
import { mapCommandBus } from "../../map/commands/CommandBus";
import { DecalLibraryPanel } from "./DecalLibraryPanel";
import { PrefabLibraryPanel } from "./PrefabLibraryPanel";

function handleReset(): void {
  if (!window.confirm("Reset terrain to flat? This cannot be undone.")) return;
  mapCommandBus.clear();
  _resetTerrainToFlat();
}

function isSculpt(tool: ToolKind): boolean {
  return tool === "sculpt-raise" || tool === "sculpt-lower";
}

function modeHint(tool: ToolKind): string {
  if (tool === "place")
    return "Left-click on terrain to place the selected prefab.";
  if (tool === "scatter") {
    return "Left-click drag to scatter; one drag = one undo.";
  }
  if (tool === "decal") {
    return "Left-click on terrain to place decal (scorch / tire tracks / blast crater).";
  }
  if (tool === "paint") {
    return "Left-click drag to paint selected material on terrain.";
  }
  if (tool === "select") {
    return "Left-click a cube to select; drag the gizmo to move it; Delete to remove.";
  }
  return `Left-click drag in viewport to ${
    tool === "sculpt-lower" ? "lower" : "raise"
  } terrain. Ctrl+Z to undo whole stroke.`;
}

const MATERIAL_LABELS: readonly { idx: MaterialIndex; label: string; swatch: string }[] = [
  { idx: 0, label: "Grass", swatch: "#527338" },
  { idx: 1, label: "Dirt", swatch: "#664c33" },
  { idx: 2, label: "Sand", swatch: "#c7ae73" },
  { idx: 3, label: "Scorched", swatch: "#1f1916" },
];

export function BrushPanel() {
  const tool = useMapStore((s) => s.tool);
  const brush = useMapStore((s) => s.brush);
  const scatter = useMapStore((s) => s.scatter);
  const paint = useMapStore((s) => s.paint);
  const decalScale = useMapStore((s) => s.decalScale);
  const decalOpacity = useMapStore((s) => s.decalOpacity);
  const setTool = useMapStore((s) => s.setTool);
  const setRadius = useMapStore((s) => s.setBrushRadius);
  const setStrength = useMapStore((s) => s.setBrushStrength);
  const setScatterRadius = useMapStore((s) => s.setScatterRadius);
  const setScatterDensity = useMapStore((s) => s.setScatterDensity);
  const setScatterScaleJitter = useMapStore((s) => s.setScatterScaleJitter);
  const setScatterRandomRotation = useMapStore(
    (s) => s.setScatterRandomRotation,
  );
  const setDecalScale = useMapStore((s) => s.setDecalScale);
  const setDecalOpacity = useMapStore((s) => s.setDecalOpacity);
  const setPaintRadius = useMapStore((s) => s.setPaintRadius);
  const setPaintStrength = useMapStore((s) => s.setPaintStrength);
  const setPaintMaterial = useMapStore((s) => s.setPaintMaterial);

  const sculpt = isSculpt(tool);

  return (
    <div className="brush-panel">
      <div className="brush-panel-header">Tool</div>
      <div className="tool-palette">
        <button
          type="button"
          className={"brush-tool-button" + (sculpt ? " is-active" : "")}
          onClick={() => setTool("sculpt-raise")}
        >
          Sculpt
        </button>
        <button
          type="button"
          className={
            "brush-tool-button" + (tool === "place" ? " is-active" : "")
          }
          onClick={() => setTool("place")}
        >
          Place
        </button>
        <button
          type="button"
          className={
            "brush-tool-button" + (tool === "scatter" ? " is-active" : "")
          }
          onClick={() => setTool("scatter")}
        >
          Scatter
        </button>
        <button
          type="button"
          className={
            "brush-tool-button" + (tool === "decal" ? " is-active" : "")
          }
          onClick={() => setTool("decal")}
        >
          Decal
        </button>
        <button
          type="button"
          className={
            "brush-tool-button" + (tool === "paint" ? " is-active" : "")
          }
          onClick={() => setTool("paint")}
        >
          Paint
        </button>
        <button
          type="button"
          className={
            "brush-tool-button" + (tool === "select" ? " is-active" : "")
          }
          onClick={() => setTool("select")}
        >
          Select
        </button>
      </div>

      {sculpt && (
        <>
          <div className="brush-panel-header">Brush</div>
          <div className="brush-tools">
            <button
              type="button"
              className={
                "brush-tool-button" +
                (tool === "sculpt-raise" ? " is-active" : "")
              }
              onClick={() => setTool("sculpt-raise")}
            >
              Raise
            </button>
            <button
              type="button"
              className={
                "brush-tool-button" +
                (tool === "sculpt-lower" ? " is-active" : "")
              }
              onClick={() => setTool("sculpt-lower")}
            >
              Lower
            </button>
          </div>
          <div className="brush-sliders">
            <label className="brush-slider-row">
              <span className="brush-slider-label">
                Radius: {brush.radiusM.toFixed(1)} m
              </span>
              <input
                type="range"
                min={0.5}
                max={20}
                step={0.5}
                value={brush.radiusM}
                onChange={(e) => setRadius(parseFloat(e.target.value))}
              />
            </label>
            <label className="brush-slider-row">
              <span className="brush-slider-label">
                Strength: {brush.strength.toFixed(2)} m/tick
              </span>
              <input
                type="range"
                min={0.05}
                max={2}
                step={0.05}
                value={brush.strength}
                onChange={(e) => setStrength(parseFloat(e.target.value))}
              />
            </label>
          </div>
        </>
      )}

      {tool === "scatter" && (
        <>
          <div className="brush-panel-header">Scatter</div>
          <div className="brush-sliders">
            <label className="brush-slider-row">
              <span className="brush-slider-label">
                Radius: {scatter.radiusM.toFixed(1)} m
              </span>
              <input
                type="range"
                min={1}
                max={30}
                step={0.5}
                value={scatter.radiusM}
                onChange={(e) =>
                  setScatterRadius(parseFloat(e.target.value))
                }
              />
            </label>
            <label className="brush-slider-row">
              <span className="brush-slider-label">
                Density: {scatter.density} / tick
              </span>
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                value={scatter.density}
                onChange={(e) =>
                  setScatterDensity(parseInt(e.target.value, 10))
                }
              />
            </label>
            <label className="brush-slider-row">
              <span className="brush-slider-label">
                Scale jitter: ±{Math.round(scatter.scaleJitter * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.05}
                value={scatter.scaleJitter}
                onChange={(e) =>
                  setScatterScaleJitter(parseFloat(e.target.value))
                }
              />
            </label>
            <label className="brush-slider-row">
              <span className="brush-slider-label">
                <input
                  type="checkbox"
                  checked={scatter.randomRotation}
                  onChange={(e) =>
                    setScatterRandomRotation(e.target.checked)
                  }
                />
                {" "}Random rotation
              </span>
            </label>
          </div>
        </>
      )}

      {tool === "decal" && (
        <>
          <div className="brush-panel-header">Decal</div>
          <div className="brush-sliders">
            <label className="brush-slider-row">
              <span className="brush-slider-label">
                Scale: {decalScale.toFixed(2)}x
              </span>
              <input
                type="range"
                min={0.3}
                max={3}
                step={0.05}
                value={decalScale}
                onChange={(e) => setDecalScale(parseFloat(e.target.value))}
              />
            </label>
            <label className="brush-slider-row">
              <span className="brush-slider-label">
                Opacity: {decalOpacity.toFixed(2)}
              </span>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={decalOpacity}
                onChange={(e) => setDecalOpacity(parseFloat(e.target.value))}
              />
            </label>
          </div>
        </>
      )}

      {tool === "paint" && (
        <>
          <div className="brush-panel-header">Material</div>
          <div className="tool-palette">
            {MATERIAL_LABELS.map((m) => (
              <button
                key={m.idx}
                type="button"
                className={
                  "brush-tool-button" +
                  (paint.materialIndex === m.idx ? " is-active" : "")
                }
                onClick={() => setPaintMaterial(m.idx)}
                title={m.label}
                style={{
                  borderLeft: `8px solid ${m.swatch}`,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="brush-sliders">
            <label className="brush-slider-row">
              <span className="brush-slider-label">
                Radius: {paint.radiusM.toFixed(1)} m
              </span>
              <input
                type="range"
                min={1}
                max={30}
                step={0.5}
                value={paint.radiusM}
                onChange={(e) => setPaintRadius(parseFloat(e.target.value))}
              />
            </label>
            <label className="brush-slider-row">
              <span className="brush-slider-label">
                Strength: {paint.strength.toFixed(2)}
              </span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={paint.strength}
                onChange={(e) => setPaintStrength(parseFloat(e.target.value))}
              />
            </label>
          </div>
        </>
      )}

      <p className="brush-hint">{modeHint(tool)}</p>

      <PrefabLibraryPanel />
      <DecalLibraryPanel />

      {sculpt && (
        <button
          type="button"
          className="brush-reset"
          onClick={handleReset}
          title="Flatten the entire terrain to zero. Clears undo history."
        >
          Reset Terrain
        </button>
      )}
    </div>
  );
}
