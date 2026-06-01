/**
 * ColorPalettePanel — authoring controls for the Color paint tool.
 *
 * Exposes a native color picker (infinite RGB), a typed hex input
 * field, 8 switchable curated palette presets, a "recent colors"
 * history persisted in localStorage, plus radius / strength sliders
 * and an erase-mode toggle. State lives in
 * `mapStore.colorPaintAuthoring`; the PaintColorController reads it
 * per stroke.
 */

import { useEffect, useState } from "react";
import { useMapStore } from "../../map/state/mapStore";

interface PalettePreset {
  readonly id: string;
  readonly name: string;
  readonly colors: readonly string[];
}

/**
 * 8 curated palette presets. Each preset is a coherent ~24-color
 * ramp/theme — the dropdown lets the user pick the family that
 * matches the scene they're painting (forest vs ocean vs neon, etc.).
 */
const PALETTE_PRESETS: readonly PalettePreset[] = [
  {
    id: "earth",
    name: "Earth Tones",
    colors: [
      "#000000", "#3a2a1f", "#5a3a26", "#8b6b3a", "#b89058", "#d9b481",
      "#404040", "#6b5a48", "#8a7252", "#a89070", "#c4ad8a", "#e8d8b8",
      "#2a4520", "#4a6b35", "#6a8a45", "#8aa858", "#a8c070", "#c8d890",
      "#1a3060", "#3266b0", "#5098e8", "#a0d8ff", "#6a5530", "#a87830",
    ],
  },
  {
    id: "vibrant",
    name: "Vibrant",
    colors: [
      "#ff0000", "#ff5500", "#ff8800", "#ffaa00", "#ffd000", "#ffff00",
      "#aaff00", "#55ff00", "#00ff00", "#00ff55", "#00ffaa", "#00ffff",
      "#00aaff", "#0055ff", "#0000ff", "#5500ff", "#aa00ff", "#ff00ff",
      "#ff00aa", "#ff0055", "#ffffff", "#cccccc", "#666666", "#000000",
    ],
  },
  {
    id: "pastel",
    name: "Pastel",
    colors: [
      "#ffd6d6", "#ffe2c0", "#fff0b8", "#fff6cc", "#e8f5c4", "#cef0c4",
      "#c4f0d8", "#c4e8f0", "#c4d8f0", "#d0c4f0", "#e8c4f0", "#f0c4e0",
      "#ffaaaa", "#ffc4a0", "#ffdc88", "#ffec99", "#dcec99", "#b8e0a0",
      "#a0e0b8", "#a0d4e0", "#a0bce0", "#b0a0e0", "#d4a0e0", "#e0a0c8",
    ],
  },
  {
    id: "neon",
    name: "Neon",
    colors: [
      "#ff00ff", "#ff0099", "#ff0044", "#ff3300", "#ff6600", "#ffaa00",
      "#ffff00", "#aaff00", "#44ff00", "#00ff44", "#00ff99", "#00ffff",
      "#00aaff", "#0066ff", "#0033ff", "#3300ff", "#6600ff", "#aa00ff",
      "#ff00cc", "#00ffcc", "#ccff00", "#ff66cc", "#66ffcc", "#ccff66",
    ],
  },
  {
    id: "sunset",
    name: "Sunset",
    colors: [
      "#1a0a2e", "#330852", "#4a1166", "#6b1d6e", "#8a2872", "#a83470",
      "#c44470", "#dc5878", "#f07090", "#ff88a8", "#ff9c70", "#ffaa55",
      "#ffbd44", "#ffd45e", "#ffeb8a", "#fff5b8", "#fce0a8", "#f0c088",
      "#d89060", "#b06840", "#884028", "#5c2818", "#3a180c", "#1a0a04",
    ],
  },
  {
    id: "forest",
    name: "Forest",
    colors: [
      "#0a1a08", "#1a2e14", "#2a4520", "#3a5828", "#4a6b35", "#5a7c45",
      "#6a8e58", "#7aa068", "#8ab278", "#9ac488", "#aad898", "#bce8a8",
      "#3a2818", "#4a3422", "#5c4030", "#6e4c3a", "#8a5e48", "#a47158",
      "#b88458", "#d09a68", "#1c2a10", "#283c18", "#384a20", "#485830",
    ],
  },
  {
    id: "ocean",
    name: "Ocean",
    colors: [
      "#001a3a", "#002a55", "#003a70", "#004a88", "#0058a0", "#006bb8",
      "#0080c8", "#1098d8", "#28b0e8", "#48c8f0", "#70dcf0", "#a0e8f0",
      "#001a30", "#003040", "#004858", "#005c6a", "#187080", "#308a98",
      "#48a4b0", "#68c0c8", "#8addd8", "#b8efe8", "#0a3050", "#205c78",
    ],
  },
  {
    id: "trending",
    name: "Trending",
    colors: [
      "#ff6b6b", "#feca57", "#48dbfb", "#1dd1a1", "#5f27cd", "#54a0ff",
      "#ee5253", "#ff9f43", "#a55eea", "#26de81", "#fd9644", "#fc5c65",
      "#2bcbba", "#eb3b5a", "#fa8231", "#f7b731", "#20bf6b", "#0fb9b1",
      "#3867d6", "#8854d0", "#000000", "#2d3436", "#636e72", "#dfe6e9",
    ],
  },
];

const RECENT_KEY = "cl_color_recents";
const RECENT_MAX = 12;

function loadRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((c) => typeof c === "string").slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function saveRecentColors(colors: readonly string[]): void {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(colors.slice(0, RECENT_MAX)),
    );
  } catch {
    /* localStorage might be disabled — silent ok */
  }
}

export function ColorPalettePanel() {
  const authoring = useMapStore((s) => s.colorPaintAuthoring);
  const setColor = useMapStore((s) => s.setColorPaintColor);
  const setStrength = useMapStore((s) => s.setColorPaintStrength);
  const setRadius = useMapStore((s) => s.setColorPaintRadius);
  const setEraseMode = useMapStore((s) => s.setColorPaintEraseMode);

  const [paletteId, setPaletteId] = useState<string>("earth");
  const [hexInput, setHexInput] = useState(authoring.color.toUpperCase());
  const [recents, setRecents] = useState<string[]>(() => loadRecentColors());

  // Sync hex input when store color changes externally (native picker,
  // hotkey, or undo).
  useEffect(() => {
    setHexInput(authoring.color.toUpperCase());
  }, [authoring.color]);

  function pickColor(hex: string): void {
    const lower = hex.toLowerCase();
    setColor(lower);
    const next = [
      lower,
      ...recents.filter((c) => c.toLowerCase() !== lower),
    ].slice(0, RECENT_MAX);
    setRecents(next);
    saveRecentColors(next);
  }

  function commitHexInput(): void {
    let v = hexInput.trim();
    if (!v.startsWith("#") && /^[0-9A-Fa-f]{6}$/.test(v)) v = "#" + v;
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
      pickColor(v.toLowerCase());
    } else {
      // invalid — revert to current store color
      setHexInput(authoring.color.toUpperCase());
    }
  }

  const activePalette =
    PALETTE_PRESETS.find((p) => p.id === paletteId) ?? PALETTE_PRESETS[0];

  return (
    <div className="color-palette-panel">
      <div className="brush-panel-header">Color</div>

      <div className="color-palette-current">
        <input
          type="color"
          value={authoring.color}
          onChange={(e) => pickColor(e.target.value)}
          aria-label="Pick any color"
        />
        <input
          type="text"
          className="color-palette-hex-input"
          maxLength={7}
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={commitHexInput}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setHexInput(authoring.color.toUpperCase());
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Hex color"
        />
      </div>

      <div className="color-palette-preset-row">
        <span className="color-palette-preset-label">Palette:</span>
        <select
          className="color-palette-preset-select"
          value={paletteId}
          onChange={(e) => setPaletteId(e.target.value)}
        >
          {PALETTE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="color-palette-presets">
        {activePalette.colors.map((c) => (
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
            onClick={() => pickColor(c)}
            title={c.toUpperCase()}
          />
        ))}
      </div>

      {recents.length > 0 && (
        <>
          <div className="color-palette-recent-title">Recent</div>
          <div className="color-palette-recents">
            {recents.map((c) => (
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
                onClick={() => pickColor(c)}
                title={c.toUpperCase()}
              />
            ))}
          </div>
        </>
      )}

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
