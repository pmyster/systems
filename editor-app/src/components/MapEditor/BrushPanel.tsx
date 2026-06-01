/**
 * BrushPanel — left rail of the Map Editor. Tool palette + brush controls.
 *
 * Adds the "Scatter" tool to the Sculpt / Place / Select / Scatter tool
 * palette. While Scatter is active the panel exposes radius, density,
 * per-instance scale jitter, and a random-rotation toggle. The prefab
 * library shows for both Place and Scatter so the user can pick what
 * each click/drag will spawn.
 *
 * State source-of-truth lives in `mapStore`. The scene manager listens
 * to the same store so radius changes here reposition the brush decal
 * ring live, and tool changes route input through the right controller
 * (Brush / Place / Selection / Scatter).
 */

import { useMapStore, _resetTerrainToFlat } from "../../map/state/mapStore";
import type { ToolKind } from "../../map/state/mapStore";
import { mapCommandBus } from "../../map/commands/CommandBus";
import { PrefabLibraryPanel } from "./PrefabLibraryPanel";

function handleReset(): void {
  if (!window.confirm("Reset terrain to flat? This cannot be undone.")) return;
  // Order matters: clear history first so any in-flight undo can't
  // re-stamp the heightmap with stale prev-snapshots after we've zeroed
  // everything. Then zero the surface and bump revision.
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
  if (tool === "select") {
    return "Left-click a cube to select; drag the gizmo to move it; Delete to remove.";
  }
  return `Left-click drag in viewport to ${
    tool === "sculpt-lower" ? "lower" : "raise"
  } terrain. Ctrl+Z to undo whole stroke.`;
}

export function BrushPanel() {
  const tool = useMapStore((s) => s.tool);
  const brush = useMapStore((s) => s.brush);
  const scatter = useMapStore((s) => s.scatter);
  const setTool = useMapStore((s) => s.setTool);
  const setRadius = useMapStore((s) => s.setBrushRadius);
  const setStrength = useMapStore((s) => s.setBrushStrength);
  const setScatterRadius = useMapStore((s) => s.setScatterRadius);
  const setScatterDensity = useMapStore((s) => s.setScatterDensity);
  const setScatterScaleJitter = useMapStore((s) => s.setScatterScaleJitter);
  const setScatterRandomRotation = useMapStore(
    (s) => s.setScatterRandomRotation,
  );

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

      <p className="brush-hint">{modeHint(tool)}</p>

      <PrefabLibraryPanel />

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
