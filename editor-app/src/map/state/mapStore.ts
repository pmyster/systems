/**
 * Authoritative client-side state for the Map Editor.
 *
 * Architecture notes:
 *   - All terrain edits flow through the Command bus (see
 *     `../commands/CommandBus.ts`). Commands MUTATE the heightmap's
 *     Float32Array in place (we cannot afford to clone a 129*129*4 byte
 *     buffer per brush stroke) and bump `terrain.revision` via
 *     `_markTerrainDirty()`. The scene manager subscribes and reacts.
 *   - Objects, spawn points, and decals are id-keyed records so React
 *     can do cheap reference-equality re-render checks via selectors.
 *   - Splatmap edits mutate the Uint8Array in place (same reasoning as
 *     the heightmap) and bump `splatmap.revision`; per-pixel dirty marks
 *     flow through `_accumulateSplatDirty`/`_drainSplatDirty`.
 *   - Tool / brush state is UI-driven (not Command-driven) and uses the
 *     `setTool` / `setBrushRadius` / `setBrushStrength` helpers.
 *
 * Naming convention:
 *   - Methods prefixed `_` are MUTATORS for Commands only. UI code MUST
 *     NOT call them — go through Commands so the change is undoable.
 *   - Public methods (no underscore) are safe for any caller.
 *
 * Zustand v5 exposes `getState` / `setState` / `subscribe` directly on the
 * hook itself, so non-React code can use `useMapStore.getState()` etc.
 * We re-export the hook as `mapStore` to make this intent explicit.
 */

import { create } from "zustand";

import { mapCommandBus } from "../commands/CommandBus";
import {
  DEFAULT_HEIGHTMAP_HEIGHT_PX,
  DEFAULT_HEIGHTMAP_WIDTH_PX,
} from "../coords/constants";
import {
  biomeRegistry,
  DEFAULT_ATMOSPHERE,
  DEFAULT_COLOR_VARIANCE,
  DEFAULT_ELEVATION_PROFILE,
  DEFAULT_SPLAT_TO_ELEVATION_MIX,
  type BiomeAtmosphere,
  type ElevationProfile,
} from "../scene/biomes";
import {
  DEFAULT_COLOR_PAINT_HEIGHT_PX,
  DEFAULT_COLOR_PAINT_WIDTH_PX,
  DEFAULT_SPLATMAP_HEIGHT_PX,
  DEFAULT_SPLATMAP_WIDTH_PX,
} from "../schema/manifest";

export type ToolKind =
  | "sculpt-raise"
  | "sculpt-lower"
  | "place"
  | "select"
  | "scatter"
  | "decal"
  | "paint"
  | "color-paint";
export type BrushFalloff = "gaussian";
export type MaterialIndex = 0 | 1 | 2 | 3;

export interface InstanceObject {
  readonly id: string;
  readonly prefabId: string;
  readonly position: { x: number; y: number; z: number };
  readonly rotation: { x: number; y: number; z: number };
  readonly scale: { x: number; y: number; z: number };
  readonly properties: Record<string, unknown>;
}

export interface SpawnPoint {
  readonly id: string;
  readonly kind: string;
  readonly position: { x: number; y: number; z: number };
  readonly facing: number;
  readonly team?: number;
}

/**
 * Decal instance — flat textured quad placed on the terrain surface.
 *
 * `decalKind` is matched against the runtime `decalRegistry` (see
 * `../scene/decals.ts`). Unknown kinds at render time log a warning and
 * skip the instance (loud-over-silent), but the data survives the
 * round-trip so re-registering the kind later restores the rendering.
 */
export interface DecalInstance {
  readonly id: string;
  readonly decalKind: string;
  readonly position: { x: number; y: number; z: number };
  /** Y-rotation in radians; decals lie flat on terrain, only yaw matters. */
  readonly rotation: number;
  /** Uniform scale multiplier on the decal's baseSize. */
  readonly scale: number;
  /** 0-1 alpha multiplier on the underlying texture. */
  readonly opacity: number;
}

export interface Selection {
  readonly kind: "none" | "object" | "spawn";
  readonly id: string | null;
}

export interface MapState {
  terrain: {
    widthPx: number;
    heightPx: number;
    /** Mutated in place by Commands; never replaced. */
    heightmap: Float32Array;
    /** Bump on every terrain edit so subscribers can refresh. */
    revision: number;
  };
  splatmap: {
    widthPx: number;
    heightPx: number;
    /**
     * RGBA bytes, one quadruple per pixel. Channel = weight for material
     * R=grass G=dirt B=sand A=scorched (each 0-255). Mutated in place by
     * PaintMaterialCommand; the GPU subscriber re-uploads on revision bump.
     */
    data: Uint8Array;
    revision: number;
  };
  /**
   * Color-paint overlay — an arbitrary RGBA tint sampled in the terrain
   * shader on top of the material + atmosphere blend. RGB carries the
   * painted color, A carries the overlay opacity (0 = no overlay, 255 =
   * full overlay). Default = all zeros — no tint anywhere. Mutated in
   * place by PaintColorCommand; the GPU subscriber re-uploads on
   * revision bump.
   */
  colorPaint: {
    widthPx: number;
    heightPx: number;
    data: Uint8Array;
    revision: number;
  };
  objects: Record<string, InstanceObject>;
  spawnPoints: Record<string, SpawnPoint>;
  decals: Record<string, DecalInstance>;
  selection: Selection;
  tool: ToolKind;
  brush: { radiusM: number; strength: number; falloff: BrushFalloff };
  /** Scatter-brush parameters (used while tool === "scatter"). */
  scatter: {
    radiusM: number;
    /** Instances dropped per scatter tick (~12 ticks/sec while dragging). */
    density: number;
    /** Per-instance scale jitter (+/- fraction of defaultScale). */
    scaleJitter: number;
    /** Random Y rotation per instance. */
    randomRotation: boolean;
  };
  /** Paint-tool parameters (used while tool === "paint"). */
  paint: {
    /** Brush radius in meters. */
    radiusM: number;
    /** Per-tick paint intensity, 0-1. */
    strength: number;
    /** Which of the 4 hardcoded materials to paint. */
    materialIndex: MaterialIndex;
  };
  /**
   * Color-paint tool authoring state (used while tool === "color-paint").
   * `color` is a CSS hex string ("#rrggbb"); the controller parses it to
   * an {r,g,b} triple per stroke. `eraseMode` toggles between additive
   * (build up opacity) and subtractive (reduce opacity) behaviour.
   */
  colorPaintAuthoring: {
    color: string;
    strength: number;
    radiusM: number;
    eraseMode: boolean;
  };
  /** Prefab id the Place tool will spawn on next click. */
  activePrefabId: string;
  /** Decal kind the Decal tool will place on next click. */
  activeDecalKind: string;
  /** Scale multiplier the Decal tool applies to new decals. */
  decalScale: number;
  /** Opacity the Decal tool gives to new decals. */
  decalOpacity: number;
  /**
   * Decal authoring rotation state. `rotation` is the explicit yaw in
   * radians applied when `randomRotation === false`; when `randomRotation`
   * is true the place controller substitutes `Math.random()*2π` per
   * placement so successive stamps don't tile suspiciously.
   */
  decalRotation: number;
  decalRandomRotation: boolean;
  /**
   * Per-prefab scale multipliers, applied on top of each prefab's
   * `defaultScale` at placement time. Empty `{}` means every prefab uses
   * the registered defaultScale unchanged (multiplier === 1.0).
   *
   * Lives in store rather than registry so the override is purely an
   * authoring preference — manifest.json never carries it, and reloading
   * a project doesn't change what a prefab "is".
   */
  prefabScaleOverrides: Record<string, number>;

  /**
   * Per-map elevation gradient + splat/elevation mix ratio (v3 schema).
   * Drives the TerrainMesh shader uniforms — each biome OWNS what its
   * above-water terrain looks like instead of a hardcoded global gradient.
   */
  elevationProfile: ElevationProfile;
  splatToElevationMix: number;
  /**
   * Per-map atmosphere — sky, sun, hemi, fog values (v4 schema). The
   * scene manager subscribes to this reference and pushes the values into
   * the live THREE.js scene whenever it changes. Each biome owns its own
   * sky/sun mood (Mars rust, Bioluminescent purple night, Volcanic smoke).
   */
  atmosphere: BiomeAtmosphere;
  /**
   * Procedural in-shader color variance applied to the elevation gradient,
   * 0..1. Produces patchy organic tint variation — low for uniform alpine
   * snow, high for rolling pastures or alien moss.
   */
  colorVariance: number;

  // --- Internal mutators (Commands only — UI must not call these) ---
  _markTerrainDirty(): void;
  _markSplatmapDirty(): void;
  _markColorPaintDirty(): void;
  _setObjects(next: Record<string, InstanceObject>): void;
  _setSpawnPoints(next: Record<string, SpawnPoint>): void;
  _setDecals(next: Record<string, DecalInstance>): void;
  _setSelection(sel: Selection): void;

  // --- UI-driven tool/brush state ---
  setTool(t: ToolKind): void;
  setBrushRadius(r: number): void;
  setBrushStrength(s: number): void;
  setActivePrefabId(id: string): void;
  setScatterRadius(r: number): void;
  setScatterDensity(n: number): void;
  setScatterScaleJitter(j: number): void;
  setScatterRandomRotation(b: boolean): void;
  setActiveDecalKind(k: string): void;
  setDecalScale(s: number): void;
  setDecalOpacity(o: number): void;
  setDecalRotation(r: number): void;
  setDecalRandomRotation(b: boolean): void;
  setPrefabScale(prefabId: string, scale: number): void;
  setPaintRadius(r: number): void;
  setPaintStrength(s: number): void;
  setPaintMaterial(i: MaterialIndex): void;
  setColorPaintColor(c: string): void;
  setColorPaintStrength(s: number): void;
  setColorPaintRadius(r: number): void;
  setColorPaintEraseMode(b: boolean): void;
}

function makeDefaultSplatmap(): Uint8Array {
  const len = DEFAULT_SPLATMAP_WIDTH_PX * DEFAULT_SPLATMAP_HEIGHT_PX * 4;
  const data = new Uint8Array(len);
  // Default: full grass on R channel — every pixel starts as (255, 0, 0, 0).
  for (let i = 0; i < len; i += 4) {
    data[i] = 255;
  }
  return data;
}

/** Default color-paint buffer — all zeros (no painted tint anywhere). */
function makeDefaultColorPaint(): Uint8Array {
  return new Uint8Array(
    DEFAULT_COLOR_PAINT_WIDTH_PX * DEFAULT_COLOR_PAINT_HEIGHT_PX * 4,
  );
}

export const useMapStore = create<MapState>((set) => ({
  terrain: {
    widthPx: DEFAULT_HEIGHTMAP_WIDTH_PX,
    heightPx: DEFAULT_HEIGHTMAP_HEIGHT_PX,
    heightmap: new Float32Array(
      DEFAULT_HEIGHTMAP_WIDTH_PX * DEFAULT_HEIGHTMAP_HEIGHT_PX,
    ),
    revision: 0,
  },
  splatmap: {
    widthPx: DEFAULT_SPLATMAP_WIDTH_PX,
    heightPx: DEFAULT_SPLATMAP_HEIGHT_PX,
    data: makeDefaultSplatmap(),
    revision: 0,
  },
  colorPaint: {
    widthPx: DEFAULT_COLOR_PAINT_WIDTH_PX,
    heightPx: DEFAULT_COLOR_PAINT_HEIGHT_PX,
    data: makeDefaultColorPaint(),
    revision: 0,
  },
  objects: {},
  spawnPoints: {},
  decals: {},
  selection: { kind: "none", id: null },
  tool: "sculpt-raise",
  brush: { radiusM: 4, strength: 0.5, falloff: "gaussian" },
  scatter: {
    radiusM: 8,
    density: 4,
    scaleJitter: 0.2,
    randomRotation: true,
  },
  paint: {
    radiusM: 6,
    strength: 0.4,
    materialIndex: 0,
  },
  colorPaintAuthoring: {
    color: "#cc4020",
    strength: 0.5,
    radiusM: 6,
    eraseMode: false,
  },
  activePrefabId: "cube",
  activeDecalKind: "scorch",
  decalScale: 1,
  decalOpacity: 0.7,
  decalRotation: 0,
  decalRandomRotation: true,
  prefabScaleOverrides: {},
  elevationProfile: DEFAULT_ELEVATION_PROFILE,
  splatToElevationMix: DEFAULT_SPLAT_TO_ELEVATION_MIX,
  atmosphere: DEFAULT_ATMOSPHERE,
  colorVariance: DEFAULT_COLOR_VARIANCE,

  _markTerrainDirty: () =>
    set((s) => ({
      terrain: { ...s.terrain, revision: s.terrain.revision + 1 },
    })),
  _markSplatmapDirty: () =>
    set((s) => ({
      splatmap: { ...s.splatmap, revision: s.splatmap.revision + 1 },
    })),
  _markColorPaintDirty: () =>
    set((s) => ({
      colorPaint: {
        ...s.colorPaint,
        revision: s.colorPaint.revision + 1,
      },
    })),
  _setObjects: (next) => set({ objects: next }),
  _setSpawnPoints: (next) => set({ spawnPoints: next }),
  _setDecals: (next) => set({ decals: next }),
  _setSelection: (sel) => set({ selection: sel }),

  setTool: (t) => set({ tool: t }),
  setBrushRadius: (r) => set((s) => ({ brush: { ...s.brush, radiusM: r } })),
  setBrushStrength: (st) =>
    set((s) => ({ brush: { ...s.brush, strength: st } })),
  setActivePrefabId: (id) => set({ activePrefabId: id }),
  setScatterRadius: (r) =>
    set((s) => ({ scatter: { ...s.scatter, radiusM: r } })),
  setScatterDensity: (n) =>
    set((s) => ({ scatter: { ...s.scatter, density: n } })),
  setScatterScaleJitter: (j) =>
    set((s) => ({ scatter: { ...s.scatter, scaleJitter: j } })),
  setScatterRandomRotation: (b) =>
    set((s) => ({ scatter: { ...s.scatter, randomRotation: b } })),
  setActiveDecalKind: (k) => set({ activeDecalKind: k }),
  setDecalScale: (s) => set({ decalScale: s }),
  setDecalOpacity: (o) => set({ decalOpacity: o }),
  setDecalRotation: (r) => set({ decalRotation: r }),
  setDecalRandomRotation: (b) => set({ decalRandomRotation: b }),
  setPrefabScale: (prefabId, scale) =>
    set((s) => ({
      prefabScaleOverrides: { ...s.prefabScaleOverrides, [prefabId]: scale },
    })),
  setPaintRadius: (r) => set((s) => ({ paint: { ...s.paint, radiusM: r } })),
  setPaintStrength: (st) =>
    set((s) => ({ paint: { ...s.paint, strength: st } })),
  setPaintMaterial: (i) =>
    set((s) => ({ paint: { ...s.paint, materialIndex: i } })),
  setColorPaintColor: (c) =>
    set((s) => ({
      colorPaintAuthoring: { ...s.colorPaintAuthoring, color: c },
    })),
  setColorPaintStrength: (st) =>
    set((s) => ({
      colorPaintAuthoring: { ...s.colorPaintAuthoring, strength: st },
    })),
  setColorPaintRadius: (r) =>
    set((s) => ({
      colorPaintAuthoring: { ...s.colorPaintAuthoring, radiusM: r },
    })),
  setColorPaintEraseMode: (b) =>
    set((s) => ({
      colorPaintAuthoring: { ...s.colorPaintAuthoring, eraseMode: b },
    })),
}));

/**
 * Non-React access — for MapSceneManager and Commands. Stable reference,
 * identical capability surface to `useMapStore` (zustand v5 puts
 * `getState` / `setState` / `subscribe` on the hook itself).
 */
export const mapStore = useMapStore;

/**
 * --- Dirty-pixel accumulator (module-singleton) -----------------------
 *
 * Commands writing to the heightmap call `_accumulateDirty(idx)` for each
 * pixel they touch BEFORE bumping the terrain revision via
 * `_markTerrainDirty()`. The scene manager's revision subscriber then
 * calls `_drainDirty()`:
 *   - non-null: apply selective per-pixel upload to the GPU (cheap).
 *   - null: do a full heightmap re-upload (covers initial mount and bulk
 *     changes like load/reset where per-pixel tracking would be silly).
 *
 * Living at module scope rather than on the store keeps zustand's state
 * shape pristine (no transient mutable Set on every snapshot). The
 * trade-off is one shared accumulator per process — fine because there's
 * exactly one MapSceneManager active at a time.
 *
 * Splatmap follows the same pattern via `_accumulateSplatDirty` /
 * `_drainSplatDirty`. Today the splatmap subscriber does a full re-upload
 * regardless (128×128×4 = 64 KB is cheap), but the dirty marks let us
 * upgrade to a sub-rect upload later without touching commands.
 */
let pendingDirty: Set<number> | null = null;
let pendingSplatDirty: Set<number> | null = null;
let pendingColorPaintDirty: Set<number> | null = null;

/** Called by Commands for each pixel they mutate. */
export function _accumulateDirty(idx: number): void {
  if (!pendingDirty) pendingDirty = new Set();
  pendingDirty.add(idx);
}

/** Called by the scene manager when reacting to a revision bump. */
export function _drainDirty(): Set<number> | null {
  const d = pendingDirty;
  pendingDirty = null;
  return d;
}

/** Called by PaintMaterialCommand for each splatmap pixel it mutates. */
export function _accumulateSplatDirty(pixelIdx: number): void {
  if (!pendingSplatDirty) pendingSplatDirty = new Set();
  pendingSplatDirty.add(pixelIdx);
}

/** Called by the scene manager when reacting to a splatmap revision bump. */
export function _drainSplatDirty(): Set<number> | null {
  const d = pendingSplatDirty;
  pendingSplatDirty = null;
  return d;
}

/**
 * Color-paint recents storage helper.
 *
 * Single source of truth for the `cl_color_recents` localStorage key —
 * the ColorPalettePanel writes via `pickColor` and the eyedropper in
 * PaintColorController writes via this helper. Both paths converge on
 * the same key + same dedup-and-cap policy so the UI never disagrees
 * with the underlying store.
 *
 * Loud-over-silent: a localStorage failure (private mode, quota, etc.)
 * is intentionally swallowed because color recents are a UX nicety —
 * the eyedropper still updates the active color via the store path even
 * if recents persistence fails.
 */
const COLOR_RECENT_KEY = "cl_color_recents";
const COLOR_RECENT_MAX = 12;

export function _pushColorRecent(hex: string): void {
  try {
    const raw = localStorage.getItem(COLOR_RECENT_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    const existing: string[] = Array.isArray(arr)
      ? arr.filter((c): c is string => typeof c === "string")
      : [];
    const lower = hex.toLowerCase();
    const next = [
      lower,
      ...existing.filter((c) => c.toLowerCase() !== lower),
    ].slice(0, COLOR_RECENT_MAX);
    localStorage.setItem(COLOR_RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage might be disabled — silent ok */
  }
}

/** Called by PaintColorCommand for each color-paint pixel it mutates. */
export function _accumulateColorPaintDirty(pixelIdx: number): void {
  if (!pendingColorPaintDirty) pendingColorPaintDirty = new Set();
  pendingColorPaintDirty.add(pixelIdx);
}

/** Called by the scene manager when reacting to a color-paint revision bump. */
export function _drainColorPaintDirty(): Set<number> | null {
  const d = pendingColorPaintDirty;
  pendingColorPaintDirty = null;
  return d;
}

/**
 * Reset store for a NEW map with given dimensions + biome.
 *
 * Replaces the heightmap and splatmap with freshly generated buffers from
 * the named biome. Clears all authored objects/decals/spawn points and the
 * Command history (the previous undo trail no longer matches reality).
 *
 * Splatmap stays at roughly half resolution of the heightmap (matches the
 * existing 128 vs 129 convention for the default map). We round down to
 * the nearest even pixel and clamp to a 32×32 minimum.
 *
 * Loud-over-silent: an unknown biomeId logs a WARN and falls back to
 * "grass" rather than throwing or silently doing nothing.
 */
export function setupNewMap(
  widthPx: number,
  heightPx: number,
  biomeId: string,
): void {
  const biome = biomeRegistry.get(biomeId);
  if (!biome) {
    console.warn(
      `[setupNewMap] Unknown biomeId "${biomeId}", falling back to "grass"`,
    );
  }
  // Splatmap stays at half resolution: round down to nearest even
  const splatW = Math.max(32, Math.floor((widthPx - 1) / 2) * 2);
  const splatH = Math.max(32, Math.floor((heightPx - 1) / 2) * 2);
  const def = biome ?? biomeRegistry.get("grass")!;
  const { heightmap, splatmap } = def.generate(
    widthPx,
    heightPx,
    splatW,
    splatH,
  );

  useMapStore.setState(
    (s) => ({
      ...s,
      terrain: {
        widthPx,
        heightPx,
        heightmap,
        revision: s.terrain.revision + 1,
      },
      objects: {},
      spawnPoints: {},
      decals: {},
      selection: { kind: "none", id: null },
      splatmap: {
        widthPx: splatW,
        heightPx: splatH,
        data: splatmap,
        revision: s.splatmap.revision + 1,
      },
      // Color-paint buffer follows the splatmap dimensions so the
      // authoring grid stays equivalent. New map = fresh empty buffer
      // (no painted tint anywhere — the biome's elevation/material
      // blend reads through unchanged).
      colorPaint: {
        widthPx: splatW,
        heightPx: splatH,
        data: new Uint8Array(splatW * splatH * 4),
        revision: s.colorPaint.revision + 1,
      },
      // Push the biome's elevation profile + mix into store so the scene
      // manager subscriber re-writes the terrain shader uniforms. Without
      // this, a "Mars" map would still render with the previous biome's
      // gradient until the user reloaded.
      elevationProfile: def.elevationProfile,
      splatToElevationMix: def.splatToElevationMix,
      // v4 — push the biome's atmosphere (sky/sun/hemi/fog) and color
      // variance. The scene manager subscribes to these and rewrites the
      // live THREE.js scene + terrain shader uniform on change.
      atmosphere: def.atmosphere,
      colorVariance: def.colorVariance,
    }),
    false,
  );
  mapCommandBus.clear();
}

/**
 * Reset terrain to flat zero. Mutates the existing heightmap in place
 * (preserving its identity for any subscriber that captured a reference),
 * marks every pixel dirty, and bumps the terrain revision so the scene
 * manager re-uploads.
 *
 * Caller is responsible for clearing the CommandBus history — this is a
 * destructive bulk reset and the existing undo trail no longer matches
 * reality once we run it.
 */
export function _resetTerrainToFlat(): void {
  const state = useMapStore.getState();
  const hm = state.terrain.heightmap;
  for (let i = 0; i < hm.length; i++) {
    hm[i] = 0;
    _accumulateDirty(i);
  }
  state._markTerrainDirty();
}

/**
 * Reset the store to initial state. Test-only — production code never
 * needs this because the store is a clean slate at module load.
 *
 * We also drain both dirty accumulators so leftover indices from a
 * previous test don't leak into the next one.
 */
export function _resetMapStore(): void {
  useMapStore.setState(
    (s) => ({
      ...s,
      terrain: {
        widthPx: DEFAULT_HEIGHTMAP_WIDTH_PX,
        heightPx: DEFAULT_HEIGHTMAP_HEIGHT_PX,
        heightmap: new Float32Array(
          DEFAULT_HEIGHTMAP_WIDTH_PX * DEFAULT_HEIGHTMAP_HEIGHT_PX,
        ),
        revision: 0,
      },
      splatmap: {
        widthPx: DEFAULT_SPLATMAP_WIDTH_PX,
        heightPx: DEFAULT_SPLATMAP_HEIGHT_PX,
        data: makeDefaultSplatmap(),
        revision: 0,
      },
      colorPaint: {
        widthPx: DEFAULT_COLOR_PAINT_WIDTH_PX,
        heightPx: DEFAULT_COLOR_PAINT_HEIGHT_PX,
        data: makeDefaultColorPaint(),
        revision: 0,
      },
      objects: {},
      spawnPoints: {},
      decals: {},
      selection: { kind: "none", id: null },
      tool: "sculpt-raise",
      brush: { radiusM: 4, strength: 0.5, falloff: "gaussian" },
      scatter: {
        radiusM: 8,
        density: 4,
        scaleJitter: 0.2,
        randomRotation: true,
      },
      paint: {
        radiusM: 6,
        strength: 0.4,
        materialIndex: 0,
      },
      colorPaintAuthoring: {
        color: "#cc4020",
        strength: 0.5,
        radiusM: 6,
        eraseMode: false,
      },
      activePrefabId: "cube",
      activeDecalKind: "scorch",
      decalScale: 1,
      decalOpacity: 0.7,
      decalRotation: 0,
      decalRandomRotation: true,
      prefabScaleOverrides: {},
      elevationProfile: DEFAULT_ELEVATION_PROFILE,
      splatToElevationMix: DEFAULT_SPLAT_TO_ELEVATION_MIX,
      atmosphere: DEFAULT_ATMOSPHERE,
      colorVariance: DEFAULT_COLOR_VARIANCE,
    }),
    false,
  );
  pendingDirty = null;
  pendingSplatDirty = null;
  pendingColorPaintDirty = null;
}
