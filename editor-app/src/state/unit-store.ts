/**
 * Unit store — single source of truth for the Child of Light Editor.
 *
 * Pure logic only. Defines:
 *   - `UnitState`: the editor-wide state shape (current unit, live
 *     voxel map, mirror flag, file metadata, dirty flag).
 *   - `UnitAction`: every reducer action the app dispatches.
 *   - `unitReducer`: pure `(state, action) => state` function.
 *   - `initialUnitState`: the blank-slate state used on app boot.
 *
 * No React imports — the Provider in `UnitStateProvider.tsx` is the
 * only place that wires this into `useReducer`. This split keeps the
 * reducer testable without a React renderer.
 *
 * Per docs/editor-app-tauri-brief.md the unit-state object is the
 * single contract every pane reads from and writes to. Per DESIGN.md
 * Principle 2 it stores only physical inputs; derived stats are
 * computed elsewhere and never persisted. Per Principle 4 the
 * `physics_version` field is bumped explicitly via BumpPhysicsVersion,
 * never automatically.
 *
 * Voxel state design (per docs/editor-app-tauri-lift-map.md):
 *   - `voxels: VoxelMap` is the live edit state — cheap to mutate,
 *     supports immutable spread, fed straight into VoxelSculptor.
 *   - `unit.chassis.voxel_data` is the on-disk shape — produced by
 *     serialize(voxels) at save time / consumed by deserialize() at
 *     load time. See state/voxel-sync.ts.
 *   - On every voxel edit, the reducer keeps `voxels` and the embedded
 *     `unit.chassis.voxel_data` in sync so BattlefieldPreview (which
 *     reads `unit`) sees the live geometry without a save round-trip.
 */

import { DEFAULT_PHYSICS_VERSION } from "../lib/constants";
import { defaultVulnerability } from "../lib/zod-schemas";
import type { PartSchematic } from "../types/part";
import type { MeshHardpoint, UnitChassis, UnitSchematic } from "../types/unit";
import type { MaterialId, VoxelMap } from "../types/voxel";

import { bumpPhysicsVersion } from "../file-ops/version-bump";
import { embedVoxelsIntoUnit } from "./voxel-sync";

// ---------------------------------------------------------------------------
// State shape.
// ---------------------------------------------------------------------------

/**
 * File metadata for the current edit session. `path` is the canonical
 * save path (set by Save / Save As / Open). `null` means the unit is
 * unsaved.
 */
export interface FileMeta {
  /** Absolute filesystem path. Null until Save As succeeds. */
  readonly path: string | null;
  /** Display name derived from the path (basename) or "Untitled". */
  readonly displayName: string;
}

/**
 * Top-level editor state. Every pane derives its props from this
 * object via the `useUnitState()` hook.
 */
export interface UnitState {
  /** The unit currently being authored. Schema-valid by construction
   *  for any state produced via the reducer (modulo in-progress edits
   *  that may not pass `safeParse` until the user fills in required
   *  fields). */
  readonly unit: UnitSchematic;
  /** Live voxel sculpting state — keyed by "x,y,z". */
  readonly voxels: VoxelMap;
  /** Mirror-X paint toggle. */
  readonly mirrorX: boolean;
  /** File metadata for save/restore. */
  readonly file: FileMeta;
  /** True after any change since the last successful Save. */
  readonly isDirty: boolean;
  /**
   * Monotonically-increasing autosave session id. Used by the autosave
   * job to name the temp file so multiple editor instances don't clobber
   * each other.
   */
  readonly sessionId: string;
}

// ---------------------------------------------------------------------------
// Initial state.
// ---------------------------------------------------------------------------

/**
 * The blank unit stamped at startup. Matches the prototype's `newUnit`
 * defaults (tools/editor/index.html lines 716-727) and the
 * `BLANK_UNIT` slot called out in the lift map.
 */
export function blankUnit(): UnitSchematic {
  const chassis = {
    chassis_class: "ground_tracked" as const,
    mass_kg: 1000,
    engine_kW: 100,
    drivetrain_efficiency: 0.8,
    // Stamp the post-Option-C coordinate-system version so brand-new units
    // skip the load-time migration path. Old files on disk (where this
    // field is absent) are treated as "pre_bake" by the loader.
    hardpoint_units_version: "world_m" as const,
  };
  return {
    kind: "unit",
    id: "new_unit",
    physics_version: DEFAULT_PHYSICS_VERSION,
    name: "New Unit",
    faction: "reclaimer",
    chassis,
    vulnerability: defaultVulnerability(chassis),
  };
}

function makeSessionId(): string {
  // Stable, sortable, no dependency. RFC4122 isn't required — autosave
  // only needs uniqueness across simultaneously-open instances.
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 1_000_000).toString(36);
  return `${t}-${r}`;
}

/** Build the app-boot state. */
export function makeInitialUnitState(): UnitState {
  const unit = blankUnit();
  return {
    unit,
    voxels: new Map() as VoxelMap,
    mirrorX: false,
    file: { path: null, displayName: "Untitled" },
    isDirty: false,
    sessionId: makeSessionId(),
  };
}

/** Default singleton instance — fine for tests / non-component readers. */
export const initialUnitState: UnitState = makeInitialUnitState();

// ---------------------------------------------------------------------------
// Actions.
// ---------------------------------------------------------------------------

/** Replace the entire unit (e.g. from AttributeForm's onUnitChange). */
interface SetUnitAction {
  readonly type: "SetUnit";
  readonly unit: UnitSchematic;
}

/** Patch top-level meta fields (id/name/faction/designer/description). */
interface UpdateMetaAction {
  readonly type: "UpdateMeta";
  readonly patch: Partial<
    Pick<UnitSchematic, "id" | "name" | "faction" | "description" | "designer">
  >;
}

/** Patch the chassis object (any subset of fields). */
interface UpdateChassisAction {
  readonly type: "UpdateChassis";
  readonly patch: Partial<UnitChassis>;
}

/** Append a part. */
interface AddPartAction {
  readonly type: "AddPart";
  readonly part: PartSchematic;
}

/** Remove a part by index. */
interface RemovePartAction {
  readonly type: "RemovePart";
  readonly index: number;
}

/** Replace a part by index. */
interface UpdatePartAction {
  readonly type: "UpdatePart";
  readonly index: number;
  readonly part: PartSchematic;
}

/** Replace the live voxel map. */
interface SetVoxelsAction {
  readonly type: "SetVoxels";
  readonly voxels: VoxelMap;
}

/** Toggle mirror-X. */
interface SetMirrorXAction {
  readonly type: "SetMirrorX";
  readonly mirrorX: boolean;
}

/** Set a single voxel (helper around SetVoxels). */
interface PlaceVoxelAction {
  readonly type: "PlaceVoxel";
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly material: MaterialId;
}

/** Remove a single voxel. */
interface RemoveVoxelAction {
  readonly type: "RemoveVoxel";
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Explicit physics_version bump (Principle 4 — never automatic). */
interface BumpPhysicsVersionAction {
  readonly type: "BumpPhysicsVersion";
}

/** Append a new hardpoint with sensible defaults (identity rotation at origin). */
interface AddHardpointAction {
  readonly type: "AddHardpoint";
  /** Optional partial seed; reducer fills missing fields with defaults. */
  readonly partial?: Partial<MeshHardpoint>;
}

/** Remove a hardpoint by id. No-op if id not present. */
interface RemoveHardpointAction {
  readonly type: "RemoveHardpoint";
  readonly id: string;
}

/**
 * Patch a hardpoint by id immutably. Used for both UI edits (form fields)
 * and gizmo edits (drag-driven position/quaternion updates).
 */
interface UpdateHardpointAction {
  readonly type: "UpdateHardpoint";
  readonly id: string;
  readonly patch: Partial<MeshHardpoint>;
}

/**
 * Load a unit from disk: replaces unit + voxels + file metadata,
 * clears dirty flag. The caller (file-ops/open.ts) has already
 * validated via Zod.
 */
interface LoadUnitAction {
  readonly type: "LoadUnit";
  readonly unit: UnitSchematic;
  readonly voxels: VoxelMap;
  readonly path: string;
}

/** Reset to a blank unit (e.g. File → New). */
interface NewUnitAction {
  readonly type: "NewUnit";
}

/**
 * Mark the current state as saved (clear dirty flag, update file
 * metadata). Called by save.ts after a successful write.
 */
interface MarkSavedAction {
  readonly type: "MarkSaved";
  readonly path: string;
}

export type UnitAction =
  | SetUnitAction
  | UpdateMetaAction
  | UpdateChassisAction
  | AddPartAction
  | RemovePartAction
  | UpdatePartAction
  | SetVoxelsAction
  | SetMirrorXAction
  | PlaceVoxelAction
  | RemoveVoxelAction
  | BumpPhysicsVersionAction
  | AddHardpointAction
  | RemoveHardpointAction
  | UpdateHardpointAction
  | LoadUnitAction
  | NewUnitAction
  | MarkSavedAction;

// ---------------------------------------------------------------------------
// Reducer helpers.
// ---------------------------------------------------------------------------

function deriveDisplayName(path: string | null): string {
  if (!path) return "Untitled";
  // Path basename — works for both POSIX and Windows separators.
  const cleaned = path.replace(/\\/g, "/");
  const idx = cleaned.lastIndexOf("/");
  const base = idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
  return base || "Untitled";
}

/**
 * Re-embed the given voxel map into `unit.chassis.voxel_data` so the
 * unit object always reflects the live sculpt. Used by every action
 * that touches `voxels`.
 */
function syncUnitWithVoxels(unit: UnitSchematic, voxels: VoxelMap): UnitSchematic {
  return embedVoxelsIntoUnit(unit, voxels);
}

// ---------------------------------------------------------------------------
// Reducer.
// ---------------------------------------------------------------------------

export function unitReducer(state: UnitState, action: UnitAction): UnitState {
  switch (action.type) {
    case "SetUnit": {
      // Preserve voxel-data embedding: if the incoming unit's chassis
      // already has voxel_data, the form-driven SetUnit shouldn't drop
      // our live voxels. Re-embed to be safe.
      const nextUnit = syncUnitWithVoxels(action.unit, state.voxels);
      return { ...state, unit: nextUnit, isDirty: true };
    }
    case "UpdateMeta": {
      const nextUnit: UnitSchematic = { ...state.unit, ...action.patch };
      return { ...state, unit: nextUnit, isDirty: true };
    }
    case "UpdateChassis": {
      const nextChassis: UnitChassis = { ...state.unit.chassis, ...action.patch };
      const nextUnit: UnitSchematic = { ...state.unit, chassis: nextChassis };
      // Re-embed voxels after chassis edit (the patch could overwrite
      // voxel_data accidentally).
      return {
        ...state,
        unit: syncUnitWithVoxels(nextUnit, state.voxels),
        isDirty: true,
      };
    }
    case "AddPart": {
      const parts = [...(state.unit.parts ?? []), action.part];
      const nextUnit: UnitSchematic = { ...state.unit, parts };
      return { ...state, unit: nextUnit, isDirty: true };
    }
    case "RemovePart": {
      const parts = [...(state.unit.parts ?? [])];
      if (action.index < 0 || action.index >= parts.length) return state;
      parts.splice(action.index, 1);
      const nextUnit: UnitSchematic = { ...state.unit, parts };
      return { ...state, unit: nextUnit, isDirty: true };
    }
    case "UpdatePart": {
      const current = state.unit.parts ?? [];
      if (action.index < 0 || action.index >= current.length) return state;
      const parts = [...current];
      parts[action.index] = action.part;
      const nextUnit: UnitSchematic = { ...state.unit, parts };
      return { ...state, unit: nextUnit, isDirty: true };
    }
    case "SetVoxels": {
      const voxels = action.voxels;
      const nextUnit = syncUnitWithVoxels(state.unit, voxels);
      return { ...state, voxels, unit: nextUnit, isDirty: true };
    }
    case "SetMirrorX": {
      if (state.mirrorX === action.mirrorX) return state;
      // Mirror toggle doesn't itself change the unit — not dirty.
      return { ...state, mirrorX: action.mirrorX };
    }
    case "PlaceVoxel": {
      const k = `${action.x},${action.y},${action.z}`;
      const voxels: VoxelMap = new Map(state.voxels);
      (voxels as Map<string, MaterialId>).set(k, action.material);
      const nextUnit = syncUnitWithVoxels(state.unit, voxels);
      return { ...state, voxels, unit: nextUnit, isDirty: true };
    }
    case "RemoveVoxel": {
      const k = `${action.x},${action.y},${action.z}`;
      if (!state.voxels.has(k)) return state;
      const voxels: VoxelMap = new Map(state.voxels);
      (voxels as Map<string, MaterialId>).delete(k);
      const nextUnit = syncUnitWithVoxels(state.unit, voxels);
      return { ...state, voxels, unit: nextUnit, isDirty: true };
    }
    case "BumpPhysicsVersion": {
      const next = bumpPhysicsVersion(state.unit.physics_version);
      if (next === state.unit.physics_version) return state;
      const nextUnit: UnitSchematic = { ...state.unit, physics_version: next };
      return { ...state, unit: nextUnit, isDirty: true };
    }
    case "AddHardpoint": {
      const current = state.unit.hardpoints ?? [];
      // Generate the next free "hp_<n>" id. We scan existing ids, parse
      // any "hp_<digit+>" suffixes, and pick max+1 so deletions don't
      // collapse the numbering and create duplicate ids.
      let maxN = 0;
      for (const h of current) {
        const m = /^hp_(\d+)$/.exec(h.id);
        if (m && m[1]) {
          const n = Number(m[1]);
          if (Number.isFinite(n) && n > maxN) maxN = n;
        }
      }
      const defaultId = `hp_${maxN + 1}`;
      const seed: MeshHardpoint = {
        id: action.partial?.id ?? defaultId,
        parent_rig_id: action.partial?.parent_rig_id ?? null,
        local_position: action.partial?.local_position ?? [0, 0, 0],
        // Identity quaternion (no rotation): (x=0, y=0, z=0, w=1).
        local_quaternion: action.partial?.local_quaternion ?? [0, 0, 0, 1],
      };
      const nextUnit: UnitSchematic = {
        ...state.unit,
        hardpoints: [...current, seed],
      };
      return { ...state, unit: nextUnit, isDirty: true };
    }
    case "RemoveHardpoint": {
      const current = state.unit.hardpoints ?? [];
      if (!current.some((h) => h.id === action.id)) return state;
      const nextUnit: UnitSchematic = {
        ...state.unit,
        hardpoints: current.filter((h) => h.id !== action.id),
      };
      return { ...state, unit: nextUnit, isDirty: true };
    }
    case "UpdateHardpoint": {
      const current = state.unit.hardpoints ?? [];
      let found = false;
      const next = current.map((h) => {
        if (h.id !== action.id) return h;
        found = true;
        return { ...h, ...action.patch };
      });
      if (!found) return state;
      const nextUnit: UnitSchematic = { ...state.unit, hardpoints: next };
      return { ...state, unit: nextUnit, isDirty: true };
    }
    case "LoadUnit": {
      // Replace everything. The loaded unit's chassis may already have
      // voxel_data — we trust the file and the post-load extracted map.
      const unit = syncUnitWithVoxels(action.unit, action.voxels);
      return {
        ...state,
        unit,
        voxels: action.voxels,
        file: {
          path: action.path,
          displayName: deriveDisplayName(action.path),
        },
        isDirty: false,
      };
    }
    case "NewUnit": {
      const fresh = makeInitialUnitState();
      // Preserve the existing session id so autosave doesn't change
      // filenames mid-session.
      return { ...fresh, sessionId: state.sessionId };
    }
    case "MarkSaved": {
      return {
        ...state,
        file: { path: action.path, displayName: deriveDisplayName(action.path) },
        isDirty: false,
      };
    }
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
