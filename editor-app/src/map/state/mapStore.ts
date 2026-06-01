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

import {
  DEFAULT_HEIGHTMAP_HEIGHT_PX,
  DEFAULT_HEIGHTMAP_WIDTH_PX,
} from "../coords/constants";
import {
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
  | "paint";
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
  /** Prefab id the Place tool will spawn on next click. */
  activePrefabId: string;
  /** Decal kind the Decal tool will place on next click. */
  activeDecalKind: string;
  /** Scale multiplier the Decal tool applies to new decals. */
  decalScale: number;
  /** Opacity the Decal tool gives to new decals. */
  decalOpacity: number;

  // --- Internal mutators (Commands only — UI must not call these) ---
  _markTerrainDirty(): void;
  _markSplatmapDirty(): void;
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
  setPaintRadius(r: number): void;
  setPaintStrength(s: number): void;
  setPaintMaterial(i: MaterialIndex): void;
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
  activePrefabId: "cube",
  activeDecalKind: "scorch",
  decalScale: 1,
  decalOpacity: 0.7,

  _markTerrainDirty: () =>
    set((s) => ({
      terrain: { ...s.terrain, revision: s.terrain.revision + 1 },
    })),
  _markSplatmapDirty: () =>
    set((s) => ({
      splatmap: { ...s.splatmap, revision: s.splatmap.revision + 1 },
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
  setPaintRadius: (r) => set((s) => ({ paint: { ...s.paint, radiusM: r } })),
  setPaintStrength: (st) =>
    set((s) => ({ paint: { ...s.paint, strength: st } })),
  setPaintMaterial: (i) =>
    set((s) => ({ paint: { ...s.paint, materialIndex: i } })),
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
      activePrefabId: "cube",
      activeDecalKind: "scorch",
      decalScale: 1,
      decalOpacity: 0.7,
    }),
    false,
  );
  pendingDirty = null;
  pendingSplatDirty = null;
}
