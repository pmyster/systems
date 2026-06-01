/**
 * ColorPalettePanel — authoring controls for the Color paint tool.
 *
 * Exposes a native color picker (so the user has an infinite RGB
 * palette), a grid of curated quick swatches for one-click common
 * choices, radius + strength sliders, and an erase mode toggle. State
 * lives in `mapStore.colorPaintAuthoring`; the PaintColorController
 * reads it per stroke.
 */

import { useMapStore } from "../../map/state/mapStore";

/**
 * Curated palette of hand-picked colors organised by hue family —
 * grayscale, warm/earth, green, blue, magenta, golden. Each row of 4
 * gives the user a coherent ramp without being prescriptive (the
 * native color picker covers anything off-palette).
 */
const QUICK_COLORS = [
  "#000000", "#404040", "#808080", "#ffffff",
  "#7c2818", "#cc4020", "#e88030", "#ffc850",
  "#2a5c1e", "#56a838", "#88d048", "#c8e878",
  "#1a3060", "#3266b0", "#5098e8", "#a0d8ff",
  "#5c1c5c", "#a040a0", "#d878c8", "#ffa0d8",
  "#6c4818", "#a87830", "#d8a850", "#f0c878",
] as const;

export function ColorPalettePanel() {
  const authoring = useMapStore((s) => s.colorPaintAuthoring);
  const setColor = useMapStore((s) => s.setColorPaintColor);
  const setStrength = useMapStore((s) => s.setColorPaintStrength);
  const setRadius = useMapStore((s) => s.setColorPaintRadius);
  const setEraseMode = useMapStore((s) => s.setColorPaintEraseMode);

  return (
    <div className="color-palette-panel">
      <div className="brush-panel-header">Color</div>
      <div className="color-palette-current">
        <input
          type="color"
          value={authoring.color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Pick any color"
        />
        <span className="color-palette-hex">
          {authoring.color.toUpperCase()}
        </span>
      </div>
      <div className="color-palette-presets">
        {QUICK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={
              "color-palette-swatch" +
              (c.toLowerCase() === authoring.color.toLowerCase()
                ? " is-active"
                : "")
            }
            style={{ background: c }}
            onClick={() => setColor(c)}
            title={c}
          />
        ))}
      </div>
      <div className="brush-sliders">
        <label className="brush-slider-row">
          <span className="brush-slider-label">
            Radius: {authoring.radiusM.toFixed(1)} m
          </span>
          <input
            type="range"
            min={0.5}
            max={30}
            step={0.5}
            value={authoring.radiusM}
            onChange={(e) => setRadius(parseFloat(e.target.value))}
          />
        </label>
        <label className="brush-slider-row">
          <span className="brush-slider-label">
            Strength: {authoring.strength.toFixed(2)}
          </span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={authoring.strength}
            onChange={(e) => setStrength(parseFloat(e.target.value))}
          />
        </label>
        <label className="brush-slider-row color-palette-erase-row">
          <span className="brush-slider-label">
            <input
              type="checkbox"
              checked={authoring.eraseMode}
              onChange={(e) => setEraseMode(e.target.checked)}
            />
            {" "}Erase mode
          </span>
        </label>
      </div>
      <p className="brush-hint">
        Left-click drag to paint. Erase mode reduces opacity in painted
        regions.
      </p>
    </div>
  );
}
