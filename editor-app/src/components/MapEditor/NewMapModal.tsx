/**
 * New Map modal — replaces the previous "click New → instant save dialog"
 * flow. Lets the user pick:
 *   - Map dimensions (4 size presets OR custom rectangular W×D).
 *   - A starting biome (procedural templates registered in
 *     `map/scene/biomes.ts` — modal iterates `biomeRegistry.list()` so
 *     new biomes show up automatically without modal edits).
 *
 * The modal itself only collects intent; it does NOT mutate the store
 * or touch disk. On "Create" it calls `onCreate({ widthPx, heightPx,
 * biomeId })` and the parent (MapMenuBar) runs `setupNewMap()` +
 * `newMapProjectFromCurrentState()` to actually create the project.
 *
 * Bounds: custom W/D clamp to [33, 2049]. The lower bound is the
 * smallest meaningful brush-able terrain; the upper bound is the
 * largest preset (Huge). Maps over ~600k vertices warn the user that
 * performance may degrade until chunked LOD lands.
 */

import { useState } from "react";

import { biomeRegistry, EARTH_BIOME_IDS } from "../../map/scene/biomes";

interface SizePreset {
  id: string;
  name: string;
  widthPx: number;
  heightPx: number;
}

const PRESETS: SizePreset[] = [
  { id: "small", name: "Small", widthPx: 129, heightPx: 129 },
  { id: "medium", name: "Medium", widthPx: 257, heightPx: 257 },
  { id: "large", name: "Large", widthPx: 513, heightPx: 513 },
  { id: "huge", name: "Huge", widthPx: 1025, heightPx: 1025 },
];

interface Props {
  onCancel: () => void;
  onCreate: (params: {
    widthPx: number;
    heightPx: number;
    biomeId: string;
  }) => void;
}

export function NewMapModal({ onCancel, onCreate }: Props) {
  const [sizeMode, setSizeMode] = useState<"preset" | "custom">("preset");
  const [presetId, setPresetId] = useState("medium");
  const [customW, setCustomW] = useState(257);
  const [customH, setCustomH] = useState(257);
  const [biomeId, setBiomeId] = useState("pasture");

  const widthPx =
    sizeMode === "preset"
      ? PRESETS.find((p) => p.id === presetId)!.widthPx
      : Math.max(33, Math.min(2049, customW));
  const heightPx =
    sizeMode === "preset"
      ? PRESETS.find((p) => p.id === presetId)!.heightPx
      : Math.max(33, Math.min(2049, customH));

  const isHuge = widthPx * heightPx > 600_000;

  function handleCreate() {
    onCreate({ widthPx, heightPx, biomeId });
  }

  return (
    <div className="new-map-overlay">
      <div className="new-map-modal">
        <div className="new-map-header">
          <h3>New Map</h3>
          <button
            type="button"
            className="new-map-close"
            onClick={onCancel}
            aria-label="Cancel"
          >
            ×
          </button>
        </div>

        <div className="new-map-section">
          <div className="new-map-section-title">Size</div>
          <div className="new-map-size-mode">
            <label>
              <input
                type="radio"
                checked={sizeMode === "preset"}
                onChange={() => setSizeMode("preset")}
              />{" "}
              Preset
            </label>
            <label>
              <input
                type="radio"
                checked={sizeMode === "custom"}
                onChange={() => setSizeMode("custom")}
              />{" "}
              Custom
            </label>
          </div>
          {sizeMode === "preset" ? (
            <div className="new-map-presets">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={
                    "new-map-preset" + (p.id === presetId ? " is-active" : "")
                  }
                  onClick={() => setPresetId(p.id)}
                >
                  <div className="new-map-preset-name">{p.name}</div>
                  <div className="new-map-preset-dim">
                    {p.widthPx - 1}m × {p.heightPx - 1}m
                  </div>
                  <div className="new-map-preset-vert">
                    {(p.widthPx * p.heightPx).toLocaleString()} verts
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="new-map-custom">
              <label>
                Width (px):{" "}
                <input
                  type="number"
                  min={33}
                  max={2049}
                  value={customW}
                  onChange={(e) =>
                    setCustomW(parseInt(e.target.value, 10) || 33)
                  }
                />
              </label>
              <label>
                Depth (px):{" "}
                <input
                  type="number"
                  min={33}
                  max={2049}
                  value={customH}
                  onChange={(e) =>
                    setCustomH(parseInt(e.target.value, 10) || 33)
                  }
                />
              </label>
              <div className="new-map-custom-info">
                → {widthPx - 1}m × {heightPx - 1}m world (
                {(widthPx * heightPx).toLocaleString()} verts)
              </div>
            </div>
          )}
          {isHuge && (
            <div className="new-map-warning">
              ⚠ Maps over ~600k vertices may have performance issues until
              chunked LOD lands. Authoring will still work.
            </div>
          )}
        </div>

        <div className="new-map-section">
          <div className="new-map-section-title">Biome</div>
          {/*
            Biomes split into EARTH (realistic) and ALIEN (sci-fi) groups.
            Loud-over-silent: any biome registered but not in
            EARTH_BIOME_IDS falls under the ALIEN heading (rather than
            silently dropping out of the list) — matching the same
            "catch-all bucket" pattern used elsewhere.
          */}
          {(() => {
            const all = biomeRegistry.list();
            const earth = all.filter((b) => EARTH_BIOME_IDS.has(b.id));
            const alien = all.filter((b) => !EARTH_BIOME_IDS.has(b.id));
            const renderCard = (b: (typeof all)[number]) => (
              <button
                key={b.id}
                type="button"
                className={
                  "new-map-biome" + (b.id === biomeId ? " is-active" : "")
                }
                onClick={() => setBiomeId(b.id)}
              >
                <div
                  className="new-map-biome-swatch"
                  style={{ background: b.previewColor }}
                />
                <div className="new-map-biome-name">{b.name}</div>
                <div className="new-map-biome-desc">{b.description}</div>
              </button>
            );
            return (
              <>
                <div className="new-map-biome-group-label">Earth</div>
                <div className="new-map-biomes">{earth.map(renderCard)}</div>
                <div className="new-map-biome-group-label">Alien</div>
                <div className="new-map-biomes">{alien.map(renderCard)}</div>
              </>
            );
          })()}
        </div>

        <div className="new-map-footer">
          <button type="button" className="new-map-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="new-map-create"
            onClick={handleCreate}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
