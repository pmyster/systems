/**
 * BattlefieldPreview — right-pane top-down 3D viewport.
 *
 * Per docs/editor-app-tauri-brief.md and the Prototype-3 lift map:
 *   - Renders the currently-edited unit on procedural terrain.
 *   - Pure visualiser: no editing, no mutation of the Schematic.
 *   - TA-style fixed-azimuth, tilt-clamped, perspective camera with
 *     strategic zoom (see DESIGN.md Pillar 1 — Terrain matters).
 *   - Re-renders the unit when the `unit` prop changes; the terrain
 *     itself is mounted once per session.
 *
 * The component owns three side-effect lifecycles:
 *   1. Mount    — build scene/renderer/terrain/lights/controls.
 *   2. Resize   — ResizeObserver on the container ref drives renderer
 *                 + camera projection updates.
 *   3. Unit swap — useEffect on the unit prop swaps the active unit
 *                  mesh, disposing the previous one.
 *
 * The render loop is RAF-driven and pauses while the document is
 * hidden (visibilitychange). FPS is sampled over ~500ms and shown in
 * the corner HUD per the brief.
 *
 * No new dependencies. Strict TS, no `any`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { join } from "@tauri-apps/api/path";

import { loadProjectile } from "../../file-ops/projectile-ops";
import { resolveInteraction } from "../../lib/resolve-interaction";
import { getEffectiveTarget } from "../../lib/fire-test/simulator";
import type { FireTestRequest } from "../../lib/fire-test/types";
import { MAP_SIZE_M } from "../../lib";
import { useMeshAssets } from "../../state/mesh-assets";
import { isWeapon } from "../../types/part";
import type { MeshHardpoint, ProjectileSchematic, UnitSchematic, WeaponPart } from "../../types";
import type { ArmorZone } from "../../types/vulnerability";

import { attachControls, type ControlsHandle } from "./controls";
import {
  FireTestController,
  type FireTestBarRequest,
} from "./FireTestController";
import {
  createFireTestScene,
  type FireTestSceneHandle,
} from "./FireTestScene";
import { buildBattlefieldScene, type BattlefieldScene } from "./scene";
import {
  createUnitOnTerrain,
  type UnitOnTerrainHandle,
} from "./unit-on-terrain";

/**
 * Absolute on-disk directory for projectile schematics. Mirrors the
 * constant in FireTestController + WeaponSubform — the editor is
 * single-user and the path is stable across sessions, so the duplication
 * is acceptable for now. A central constant would be the next refactor.
 */
const PROJECTILES_DIR = "C:\\dev\\Strategy Game\\units\\projectiles";

/**
 * Sleep helper used by the per-HP firing sequencer. A 0/negative ms wait
 * resolves immediately so the burst loop doesn't queue a useless
 * setTimeout(0) on the macrotask queue.
 */
const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms));

interface BattlefieldPreviewProps {
  readonly unit: UnitSchematic;
}

// ---------------------------------------------------------------------------
// Inline styles — kept here so the component is self-contained and the
// integration agent doesn't need to touch App.css. Faint, top-right
// overlays per the brief; pointer-events: none so they never steal input.
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  background: "#1a1d28",
};

const canvasWrapStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  cursor: "grab",
  userSelect: "none",
};

const hudStyle: React.CSSProperties = {
  position: "absolute",
  top: 8,
  right: 10,
  padding: "4px 8px",
  background: "rgba(10, 13, 18, 0.55)",
  border: "1px solid rgba(201, 165, 92, 0.35)",
  borderRadius: 3,
  font: "11px/1.35 SF Mono, Menlo, Consolas, monospace",
  color: "#d8dde6",
  pointerEvents: "none",
  letterSpacing: "0.04em",
};

const hudTitleStyle: React.CSSProperties = {
  color: "#c9a55c",
  fontWeight: 600,
};

const hudRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
};

const hudDimStyle: React.CSSProperties = {
  color: "#8a93a3",
};

const hudValueStyle: React.CSSProperties = {
  color: "#c9a55c",
  fontVariantNumeric: "tabular-nums",
};

// ---------------------------------------------------------------------------
// HP DEBUG HUD — diagnostic overlay that surfaces the FIRST hardpoint's
// live world-space aim each frame. The user cannot open DevTools, so this
// HUD is the only way to verify pos/dir/Euler updates without external tools.
//
// Scratch instances live at module scope so the per-frame tick never
// allocates (the render loop runs at ~60Hz; allocating a Vector3 every
// frame is wasted GC pressure when the values can be reused).
// ---------------------------------------------------------------------------
const hpHudScratchDir = new THREE.Vector3();

const hpHudStyle: React.CSSProperties = {
  position: "absolute",
  top: 140,
  right: 10,
  padding: "6px 8px",
  background: "rgba(10, 13, 18, 0.78)",
  border: "1px solid rgba(201, 165, 92, 0.35)",
  borderRadius: 4,
  font: "12px/1.4 SF Mono, Menlo, Consolas, monospace",
  color: "#ffffff",
  pointerEvents: "none",
  letterSpacing: "0.02em",
  width: 240,
  whiteSpace: "pre",
};

const hpHudTitleStyle: React.CSSProperties = {
  color: "#c9a55c",
  fontWeight: 600,
  marginBottom: 2,
};

interface HpHudSnapshot {
  readonly id: string | null;
  readonly pos: readonly [number, number, number] | null;
  readonly dir: readonly [number, number, number] | null;
  readonly pitchDeg: number | null;
  readonly yawDeg: number | null;
  /** Which event last refreshed the HUD — surfaced in the overlay so the
   *  user can see at a glance that the HUD is at rest, not live. */
  readonly lastEvent: string | null;
  /** Count of hardpoints currently checked in the fire-test bar. */
  readonly selectedCount: number;
  /** Total mounted hardpoints on the unit. */
  readonly totalCount: number;
}

const HP_HUD_EMPTY: HpHudSnapshot = {
  id: null,
  pos: null,
  dir: null,
  pitchDeg: null,
  yawDeg: null,
  lastEvent: null,
  selectedCount: 0,
  totalCount: 0,
};

/** Format a triple to fixed-decimal display. Returns "—" when null. */
function fmtTriple(
  v: readonly [number, number, number] | null,
  decimals: number,
): string {
  if (v === null) return "—";
  return `${v[0].toFixed(decimals)}, ${v[1].toFixed(decimals)}, ${v[2].toFixed(decimals)}`;
}

/**
 * Legacy fixed spawn — used only when the unit has no mesh (voxel-only or
 * empty unit). Mirrors the original hardcoded sky-above-centre point so
 * the fallback behaviour is preserved bit-for-bit.
 */
const FALLBACK_SPAWN: readonly [number, number, number] = [
  MAP_SIZE_M / 2,
  4,
  MAP_SIZE_M / 2,
];

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export function BattlefieldPreview({ unit }: BattlefieldPreviewProps): React.ReactElement {
  // Container ref hosts the renderer's canvas; ResizeObserver watches it.
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Long-lived scene handles — built once per mount, torn down on
  // unmount. Held in refs so re-renders don't reconstruct them.
  const sceneRef = useRef<BattlefieldScene | null>(null);
  const unitSlotRef = useRef<UnitOnTerrainHandle | null>(null);
  const controlsRef = useRef<ControlsHandle | null>(null);
  const fireTestRef = useRef<FireTestSceneHandle | null>(null);

  // Latest unit — captured in a ref so the onFire callback (created
  // once via useCallback) always resolves against the current unit
  // without forcing a re-creation that would cause stale references.
  const unitRef = useRef<UnitSchematic>(unit);
  useEffect(() => {
    unitRef.current = unit;
  }, [unit]);

  // Whether a fire-test shot is currently in flight — drives the
  // controller's disabled state on Fire / Replay.
  const [fireBusy, setFireBusy] = useState<boolean>(false);

  // FPS is the only render-loop value surfaced to React state. Updating
  // it ~twice/sec is fine; the render loop itself never calls setState.
  const [fps, setFps] = useState<number>(0);

  // Diagnostic — which path the preview rendered and whether a skin was
  // attached. Surfaced in the HUD so rendering issues are visible without
  // a debugger.
  const [srcMode, setSrcMode] = useState<"mesh" | "voxel" | "empty">("empty");
  const [skinOn, setSkinOn] = useState<boolean>(false);

  // Mesh-first source + skin from the shared context. When a mesh is present
  // the preview renders a deep clone of it; otherwise it falls back to voxels.
  //
  // The fire-test selection (which hardpoints are checked in the bar) also
  // lives in the shared context — both viewers (Mesh Workspace + this one)
  // read it to tint arrows cyan. The controller pushes updates here via
  // the setter; the slot is bridged through a useEffect below.
  const {
    meshSource,
    skinImage,
    fireSelectedHardpointIds,
    setFireSelectedHardpointIds,
  } = useMeshAssets();

  // Ref so the long-lived callbacks (handleFire, handleAimChange) always
  // see the latest selection without re-creating themselves on every
  // toggle. Same pattern as `unitRef` above.
  const fireSelectedHardpointIdsRef = useRef<ReadonlySet<string>>(
    fireSelectedHardpointIds,
  );
  useEffect(() => {
    fireSelectedHardpointIdsRef.current = fireSelectedHardpointIds;
  }, [fireSelectedHardpointIds]);

  // Track which hardpoint was LAST FIRED so the HUD can show its details
  // (per brief). Held as state because the HUD re-reads it on every refresh.
  const [lastFiredHpId, setLastFiredHpId] = useState<string | null>(null);
  const lastFiredHpIdRef = useRef<string | null>(null);
  useEffect(() => {
    lastFiredHpIdRef.current = lastFiredHpId;
  }, [lastFiredHpId]);

  // HP DEBUG HUD live snapshot. Updated by a RAF tick that polls the first
  // hardpoint's world transform each frame and only re-renders React when
  // a tracked value has changed at display precision.
  const [hpHud, setHpHud] = useState<HpHudSnapshot>(HP_HUD_EMPTY);

  // -------------------------------------------------------------------------
  // Mount: build scene + start render loop.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const battlefield = buildBattlefieldScene();
    sceneRef.current = battlefield;

    // Mount the renderer's canvas into the container.
    const canvas = battlefield.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    // Mount the active unit on the terrain.
    unitSlotRef.current = createUnitOnTerrain(
      battlefield.scene,
      battlefield.terrain,
      unit,
    );

    // Attach pointer / keyboard / wheel handlers.
    controlsRef.current = attachControls(
      canvas,
      battlefield.camera,
      battlefield.lighting,
    );

    // Build the fire-test overlay scene. Uses the same scene + camera
    // + canvas the rest of the preview shares.
    fireTestRef.current = createFireTestScene(
      battlefield.scene,
      battlefield.camera.camera,
      canvas,
    );

    // -- Resize ---------------------------------------------------------------
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        battlefield.resize(width, height);
      }
    });
    ro.observe(container);
    // Initial size so the first frame is correct.
    const initRect = container.getBoundingClientRect();
    battlefield.resize(initRect.width, initRect.height);

    // -- Render loop ----------------------------------------------------------
    let raf = 0;
    let running = true;
    let lastTime = performance.now();
    let fpsFrames = 0;
    let fpsLast = lastTime;

    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      controlsRef.current?.tickKeys(dt);
      unitSlotRef.current?.tickRig(dt);
      fireTestRef.current?.tick(dt * 1000);

      battlefield.renderer.render(battlefield.scene, battlefield.camera.camera);

      fpsFrames++;
      if (now - fpsLast > 500) {
        const sample = (fpsFrames * 1000) / (now - fpsLast);
        setFps(Math.round(sample));
        fpsFrames = 0;
        fpsLast = now;
      }
    };
    raf = requestAnimationFrame(tick);

    // -- Pause on tab-hidden --------------------------------------------------
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        lastTime = performance.now();
        fpsLast = lastTime;
        fpsFrames = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // -- Cleanup --------------------------------------------------------------
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      controlsRef.current?.detach();
      controlsRef.current = null;
      fireTestRef.current?.dispose();
      fireTestRef.current = null;
      unitSlotRef.current?.dispose();
      unitSlotRef.current = null;
      if (canvas.parentNode === container) {
        container.removeChild(canvas);
      }
      battlefield.dispose();
      sceneRef.current = null;
    };
    // Intentionally empty deps — the scene lives for the component's
    // lifetime. The unit prop is reconciled by a separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Unit reconciliation: mesh-first when a mesh source exists (deep-cloned +
  // skinned), voxel fallback otherwise. Terrain and lights remain.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const slot = unitSlotRef.current;
    if (!slot) return;
    if (meshSource) {
      slot.setMeshUnit(
        meshSource,
        skinImage,
        unit.rig ?? [],
        unit.hardpoints ?? [],
        unit.chassis.scale ?? 1,
        unit.chassis.length_m,
      );
      setSrcMode("mesh");
      setSkinOn(skinImage !== null);
    } else {
      slot.setUnit(unit); // voxel fallback for mesh-less units
      setSrcMode("voxel");
      setSkinOn(false);
    }
  }, [unit, meshSource, skinImage]);

  // -------------------------------------------------------------------------
  // HP DEBUG HUD: EVENT-DRIVEN snapshot of the FIRST hardpoint's world aim.
  //
  // Previously this was a per-frame RAF poll. That was wrong — it called
  // `getHardpointAim` (which calls `updateMatrixWorld(true)` and reads
  // world transforms) ~60 times per second, indefinitely, even when the
  // unit was idle. World transforms only change on actual events, so the
  // HUD now refreshes only when those events fire:
  //
  //   • the hardpoint document changes (form edit) — see useEffect below
  //   • the user clicks Fire — see handleFire
  //   • the user changes aim parameters — see handleAimChange
  //   • snap-aim-to-target runs (covered by handleFire)
  //
  // Industry standard (Unreal sockets, Unity attach-points): the world
  // position of an attach point is computed only when requested. We
  // honour that here. The HUD label below tags the last event so the
  // user can see at a glance that the value is "at rest", not live.
  //
  // Declared above the useEffects that depend on it (the React hook-deps
  // closure can't forward-reference a callback).
  // -------------------------------------------------------------------------
  const refreshHpHud = useCallback((eventLabel: string): void => {
    const slot = unitSlotRef.current;
    const currentUnit = unitRef.current;
    const hardpoints: readonly MeshHardpoint[] = currentUnit.hardpoints ?? [];
    const selectedIds = fireSelectedHardpointIdsRef.current;
    const lastFired = lastFiredHpIdRef.current;
    const totalCount = hardpoints.length;
    const selectedCount = (() => {
      let n = 0;
      for (const h of hardpoints) if (selectedIds.has(h.id)) n++;
      return n;
    })();

    // Pick the HP whose details we show in the detail block. Per brief:
    // last-fired wins, else first selected, else nothing.
    let detailId: string | null = null;
    if (lastFired !== null && hardpoints.some((h) => h.id === lastFired)) {
      detailId = lastFired;
    } else {
      for (const h of hardpoints) {
        if (selectedIds.has(h.id)) {
          detailId = h.id;
          break;
        }
      }
    }

    if (!slot || detailId === null) {
      setHpHud({
        ...HP_HUD_EMPTY,
        lastEvent: eventLabel,
        selectedCount,
        totalCount,
      });
      return;
    }

    const aim = slot.getHardpointAim(detailId);
    if (!aim) {
      setHpHud({
        ...HP_HUD_EMPTY,
        lastEvent: eventLabel,
        selectedCount,
        totalCount,
      });
      return;
    }

    const round3 = (n: number): number => Math.round(n * 1000) / 1000;
    const px = round3(aim.position[0]);
    const py = round3(aim.position[1]);
    const pz = round3(aim.position[2]);
    const dx = round3(aim.direction[0]);
    const dy = round3(aim.direction[1]);
    const dz = round3(aim.direction[2]);

    // Derive pitch + yaw from the unit direction vector (XYZ Euler).
    // Roll cannot be recovered from a direction alone — the HUD shows "—".
    // Clamp y to [-1,1] before asin to guard against any tiny numerical
    // drift that would otherwise produce NaN.
    hpHudScratchDir.set(dx, dy, dz);
    const dyClamped = Math.max(-1, Math.min(1, hpHudScratchDir.y));
    const pitchDeg = (Math.asin(dyClamped) * 180) / Math.PI;
    const yawDeg =
      (Math.atan2(hpHudScratchDir.x, hpHudScratchDir.z) * 180) / Math.PI;

    setHpHud({
      id: detailId,
      pos: [px, py, pz],
      dir: [dx, dy, dz],
      pitchDeg,
      yawDeg,
      lastEvent: eventLabel,
      selectedCount,
      totalCount,
    });
  }, []);

  // Bridge selection state to the scene's arrow tint + refresh the HUD.
  // The slot's setHardpointHighlight is a Three.js mutation (recolours
  // arrow materials); React owns the React state, so this useEffect is
  // the seam between them. Runs on every selection change and also on
  // mount-mode swaps (the new mount needs the current selection painted).
  useEffect(() => {
    unitSlotRef.current?.setHardpointHighlight(fireSelectedHardpointIds);
    refreshHpHud("selection-change");
  }, [fireSelectedHardpointIds, meshSource, skinImage, refreshHpHud]);

  // -------------------------------------------------------------------------
  // Live-sync hardpoint Object3Ds with `unit.hardpoints`.
  //
  // The unit's mesh is mounted once per (unit, meshSource, skinImage)
  // change; mountHardpoints runs as part of that mount. But the user
  // can edit hardpoint pos/rot/parent_rig at any time — those edits
  // produce a new `unit` reference but the mesh source doesn't change,
  // so the mount-effect above SKIPS the work that would re-place the
  // hardpoint Object3Ds. Without this effect, the mounted Object3D
  // would drift from the document and fire tests would fire from
  // stale coordinates.
  //
  // The pattern: derived scene state (Object3D transforms) must always
  // track the document (unit.hardpoints). updateHardpointData re-runs
  // the attach() dance under the existing rig hierarchy, so an edit
  // propagates without remounting the whole mesh.
  // -------------------------------------------------------------------------
  useEffect(() => {
    unitSlotRef.current?.updateHardpointData(unit.hardpoints ?? []);
    // The slot just re-mounted hardpoint Object3Ds — their world
    // transforms changed, so refresh the HUD. This is the event-driven
    // replacement for the previous RAF poll: the HUD now updates only
    // when the document changes (form edit, file open, etc.).
    refreshHpHud("hardpoints-change");
  }, [unit.hardpoints, refreshHpHud]);

  // On (re)mount of the mesh source, the hardpoints attach to a new
  // mesh hierarchy — pull a fresh HUD reading so the overlay isn't
  // showing stale values from the previous mesh.
  useEffect(() => {
    refreshHpHud("mesh-mount");
  }, [meshSource, skinImage, refreshHpHud]);

  // -------------------------------------------------------------------------
  // Fire-test handlers — keep the aim marker live as the author tweaks
  // projectile/range, and run the resolver + scene on Fire.
  // -------------------------------------------------------------------------

  // Derive the projectile spawn AND firing direction from the muzzle aim
  // (rig-tagged node if available; bbox top-front + south otherwise).
  // When no mesh is mounted — voxel-only or empty unit — fall back to the
  // legacy sky-above-centre point firing south AND log a warning so the
  // silent fallback never sneaks past code review.
  const computeAim = useCallback((): {
    spawn: [number, number, number];
    direction: [number, number, number];
  } => {
    const slot = unitSlotRef.current;
    const currentUnit = unitRef.current;

    // Priority 1: explicit hardpoint authoring beats every legacy path.
    // Multi-HP units: the FIRST SELECTED hardpoint drives the live aim
    // marker (Front/Side/Rear/Top + Range produce one shared target);
    // each individual barrel still fires from its own muzzle in
    // handleFire's per-HP loop. When nothing is selected (or none of
    // the selected ids are mounted) we fall through to the first
    // mounted hardpoint, then the legacy rig/bbox fallback. This keeps
    // single-HP units working exactly as before AND lets a multi-HP
    // user see the shared target preview update without having to
    // tick a specific "marker driver" toggle.
    const hardpoints = currentUnit.hardpoints ?? [];
    const selected = fireSelectedHardpointIdsRef.current;
    if (slot && hardpoints.length > 0) {
      for (const h of hardpoints) {
        if (!selected.has(h.id)) continue;
        const aim = slot.getHardpointAim(h.id);
        if (aim) {
          return {
            spawn: [aim.position[0], aim.position[1], aim.position[2]],
            direction: [aim.direction[0], aim.direction[1], aim.direction[2]],
          };
        }
      }
      // No SELECTED hardpoint resolved — try the first mounted hardpoint
      // so the marker still appears for an unchecked-but-mounted unit.
      for (const h of hardpoints) {
        const aim = slot.getHardpointAim(h.id);
        if (aim) {
          return {
            spawn: [aim.position[0], aim.position[1], aim.position[2]],
            direction: [aim.direction[0], aim.direction[1], aim.direction[2]],
          };
        }
      }
      // Fell through every hardpoint without a mount — getHardpointAim has
      // already warned about each missing id. Fall through to muzzle/bbox.
    }

    // Priority 2: legacy muzzle rig + muzzle_forward axis (still supported
    // for existing units; slice-2 will deprecate once migration lands).
    const aim = slot?.getMuzzleAim(currentUnit) ?? null;
    if (aim) {
      return {
        spawn: [aim.position[0], aim.position[1], aim.position[2]],
        direction: [aim.direction[0], aim.direction[1], aim.direction[2]],
      };
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[FireTest] unit mesh bbox empty — using fallback spawn point",
    );
    return {
      spawn: [FALLBACK_SPAWN[0], FALLBACK_SPAWN[1], FALLBACK_SPAWN[2]],
      direction: [0, 0, -1],
    };
  }, []);

  /**
   * Resolve a weapon part on the unit by id, or return null if absent /
   * not a weapon. Loud-over-silent: a stale `weapon_part_id` is reported
   * once per (id, reason) via the warn cache.
   */
  const resolveWeaponPart = useCallback(
    (weaponId: string | undefined): WeaponPart | null => {
      if (weaponId === undefined) return null;
      const u = unitRef.current;
      const part = (u.parts ?? []).find((p) => p.id === weaponId) ?? null;
      if (part === null) return null;
      if (!isWeapon(part)) return null;
      return part;
    },
    [],
  );

  /**
   * Per-(weapon id) projectile cache keyed by projectile_id. Each load
   * goes to disk; we cache for the lifetime of the component so a
   * burst-fire HP doesn't re-read the same file every shot. The cache
   * is cleared when the unit prop changes (a different unit may
   * reference different projectiles, and stale entries don't help).
   */
  const projectileCacheRef = useRef<Map<string, ProjectileSchematic>>(
    new Map(),
  );
  useEffect(() => {
    // Cache is scoped to a single unit's lifetime — wipe on unit swap.
    projectileCacheRef.current = new Map();
  }, [unit.id]);

  const loadProjectileForWeapon = useCallback(
    async (weapon: WeaponPart): Promise<ProjectileSchematic | null> => {
      const id = weapon.projectile_id;
      if (id === null || id === undefined || id === "") return null;
      const cached = projectileCacheRef.current.get(id);
      if (cached !== undefined) return cached;
      try {
        const path = await join(PROJECTILES_DIR, `${id}.proj.json`);
        const p = await loadProjectile(path);
        projectileCacheRef.current.set(id, p);
        return p;
      } catch (e: unknown) {
        // eslint-disable-next-line no-console
        console.warn(
          `[FireTest] failed to load projectile "${id}" for weapon ` +
            `"${weapon.id}": ${e instanceof Error ? e.message : String(e)}`,
        );
        return null;
      }
    },
    [],
  );

  /**
   * Last hitZone + range broadcast from the bar — used by handleAimChange
   * + handleFire to compute the effective target consistently. Held in a
   * ref so the callbacks (created once) always see the latest values
   * without forcing re-creation.
   */
  const lastHitZoneRef = useRef<ArmorZone>("front");
  const lastRangeRef = useRef<number>(500);

  const handleAimChange = useCallback(
    (hitZone: ArmorZone, range_m: number): void => {
      lastHitZoneRef.current = hitZone;
      lastRangeRef.current = range_m;
      const fts = fireTestRef.current;
      if (!fts) return;

      // Update the hit-zone label sprite first — it doesn't depend on
      // having any armed HP and reads as a useful preview even before
      // a weapon is assigned. (The brief calls this out as "rename the
      // row label … and the active zone visually selected".)
      fts.setHitZoneLabel(hitZone);

      // Resolve the FIRST selected armed HP's weapon → projectile so the
      // marker can use the correct delivery_kind. When no armed HP is
      // selected, the marker still shows the bbox-derived aim (legacy
      // behaviour); we use "ballistic" as the assumed kind for the
      // straight-line aim projection — visually correct for the common
      // case where no projectile-specific arc is in play.
      const u = unitRef.current;
      const selectedIds = fireSelectedHardpointIdsRef.current;
      const hardpoints: readonly MeshHardpoint[] = u.hardpoints ?? [];
      let firstArmedSelected: MeshHardpoint | null = null;
      for (const h of hardpoints) {
        if (!selectedIds.has(h.id)) continue;
        const w = resolveWeaponPart(h.weapon_part_id);
        if (w !== null) {
          firstArmedSelected = h;
          break;
        }
      }

      const { spawn, direction } = computeAim();
      // Default to ballistic for the no-projectile preview path.
      // The straight-line projection is identical for ballistic / guided
      // / beam, so this is correct for the three most common cases.
      let kind: ProjectileSchematic["delivery_params"]["kind"] = "ballistic";
      if (firstArmedSelected !== null) {
        const w = resolveWeaponPart(firstArmedSelected.weapon_part_id);
        if (w !== null) {
          // Try the cache synchronously; if not yet loaded, kick off
          // a load + refresh on resolve. The marker reads correctly
          // either way — the worst case is one frame of "ballistic"
          // projection before the loaded projectile flips it to placed
          // or dropped (in which case the marker pins to feet anyway).
          const id = w.projectile_id;
          if (id !== null && id !== undefined && id !== "") {
            const cached = projectileCacheRef.current.get(id);
            if (cached !== undefined) {
              kind = cached.delivery_params.kind;
            } else {
              // Fire-and-forget the load. When it lands we re-trigger
              // an aim refresh by calling ourselves; the cache hit
              // path then runs.
              void loadProjectileForWeapon(w).then((p) => {
                if (p !== null) {
                  // Same hitZone/range — re-enter so the marker now
                  // uses the correct delivery kind.
                  handleAimChange(
                    lastHitZoneRef.current,
                    lastRangeRef.current,
                  );
                }
              });
            }
          }
        }
      }
      const target = getEffectiveTarget(spawn, direction, range_m, kind);
      fts.setTargetMarker(spawn, target);
      unitSlotRef.current?.setAimTarget(target);
      refreshHpHud("aim-change");
    },
    [computeAim, refreshHpHud, resolveWeaponPart, loadProjectileForWeapon],
  );

  const handleFire = useCallback(
    async (barRequest: FireTestBarRequest): Promise<void> => {
      const fts = fireTestRef.current;
      const slot = unitSlotRef.current;
      if (!fts || !slot) return;
      const currentUnit = unitRef.current;
      const selectedIds = fireSelectedHardpointIdsRef.current;

      // Resolve which hardpoints we'll fire from: every selected id that
      // is mounted, parented, AND armed with a weapon part that resolves
      // to a real WeaponPart on the unit. The controller's disabled
      // state already prevents firing when no firable HP is selected;
      // we re-filter defensively so a transient race during a unit swap
      // doesn't fire from a ghost id or an unarmed HP.
      const hardpoints: readonly MeshHardpoint[] = currentUnit.hardpoints ?? [];
      interface FirableHp {
        readonly hp: MeshHardpoint;
        readonly weapon: WeaponPart;
        readonly projectile: ProjectileSchematic;
      }
      const firing: FirableHp[] = [];
      for (const h of hardpoints) {
        if (!selectedIds.has(h.id)) continue;
        if (h.parent_rig_id === null || h.parent_rig_id === "") continue;
        const w = resolveWeaponPart(h.weapon_part_id);
        if (w === null) continue;
        const p = await loadProjectileForWeapon(w);
        if (p === null) {
          // eslint-disable-next-line no-console
          console.warn(
            `[FireTest] weapon "${w.id}" on hp "${h.id}" has no loadable ` +
              `projectile (projectile_id: ${w.projectile_id ?? "unset"}); ` +
              `skipping this barrel.`,
          );
          continue;
        }
        firing.push({ hp: h, weapon: w, projectile: p });
      }

      if (firing.length === 0) {
        // Loud-over-silent: if the button was clicked with no firable
        // HP (e.g. race during a unit-swap or every weapon missing its
        // projectile file), say so instead of silently doing nothing.
        // eslint-disable-next-line no-console
        console.warn(
          `[FireTest] handleFire invoked with no firable hardpoints — ` +
            `selection had ${selectedIds.size} id(s), unit has ` +
            `${hardpoints.length} hardpoint(s) — none resolved to a ` +
            `parented+armed+projectile-loaded barrel. Skipping.`,
        );
        return;
      }

      // Re-aim rigs right before firing. We use the FIRST firing HP's
      // spawn/direction to pick a shared aim target — Front/Side/Rear/
      // Top yield ONE world point per click. Each HP then fires from
      // its OWN spawn toward that shared point. The delivery_kind used
      // to project the aim point comes from the FIRST firing HP's
      // projectile; mixed-kind volleys (rare) all aim at the same world
      // target which is correct for any straight-line delivery.
      const firstAim = slot.getHardpointAim(firing[0].hp.id);
      if (firstAim === null) {
        // eslint-disable-next-line no-console
        console.warn(
          `[FireTest] firing HP "${firing[0].hp.id}" has no aim — ` +
            `slot returned null. Skipping fire.`,
        );
        return;
      }
      const sharedTarget = getEffectiveTarget(
        [firstAim.position[0], firstAim.position[1], firstAim.position[2]],
        [firstAim.direction[0], firstAim.direction[1], firstAim.direction[2]],
        barRequest.range_m,
        firing[0].projectile.delivery_params.kind,
      );
      slot.setAimTarget(sharedTarget);
      slot.snapAimToTarget();

      fts.setTargetMarker(
        [firstAim.position[0], firstAim.position[1], firstAim.position[2]],
        sharedTarget,
      );
      fts.setHitZoneLabel(barRequest.hitZone);

      // Track the FIRST firing HP as "last fired" for the HUD details.
      setLastFiredHpId(firing[0].hp.id);
      refreshHpHud("fire");

      setFireBusy(true);
      try {
        // --------------------------------------------------------------
        // Per-HP sequencer. Each firable HP runs its own async chain:
        //
        //   sleep(charge_time_ms)
        //   for i in 0..burst_count-1:
        //     re-read aim (rig may have slewed mid-burst)
        //     fts.fire(request, outcome, spawn, target)
        //     if i < burst-1: sleep(burst_delay_ms || fire_rate_ms)
        //   sleep(cooldown_ms)
        //
        // The cooldown gate is part of the sequencer's promise — Promise.all
        // doesn't resolve until every HP has completed its cooldown, so
        // the Fire button stays disabled until the slowest barrel is
        // ready to fire again. This is the intended UX: you can't
        // re-press Fire mid-burst.
        //
        // Default values reproduce legacy single-shot behaviour exactly:
        //   charge=0, burst=1, burst_delay=0, fire_rate=0, cooldown=0
        // → sleep(0); fire once; sleep(0). Same shot, same timing.
        // --------------------------------------------------------------
        const sequencerPromises: Promise<void>[] = [];
        for (const f of firing) {
          const w = f.weapon;
          // Apply zero-default semantics here at the boundary so the
          // sequencer below operates on concrete numbers.
          const charge_ms = Math.max(0, w.charge_time_ms ?? 0);
          const fire_rate_ms = Math.max(0, w.fire_rate_ms ?? 0);
          const burst_count = Math.max(1, w.burst_count ?? 1);
          // Effective burst delay: per the brief, `burst_delay_ms ||
          // fire_rate_ms` — when burst_delay is unset OR 0, fall back to
          // fire_rate. This way an author who sets only fire_rate (the
          // sustained-fire knob) gets reasonable burst spacing for free;
          // a burst-only author who sets burst_delay = 100 overrides
          // fire_rate locally without having to clear the latter.
          const effective_burst_delay_ms = Math.max(
            0,
            (w.burst_delay_ms ?? 0) || fire_rate_ms,
          );
          const cooldown_ms = Math.max(0, w.cooldown_ms ?? 0);

          // Resolve outcome ONCE per HP. Outcome is purely a function of
          // (projectile, target vulnerability, hit zone, range) — none
          // of those change within a burst, so re-resolving per shot
          // would be wasted work AND inconsistent if the projectile
          // were edited mid-burst (unlikely but possible via HMR).
          const outcome = resolveInteraction(
            f.projectile,
            {
              vulnerability: currentUnit.vulnerability,
              thermal_cap_mj: currentUnit.chassis.thermal_capacity_MJ ?? 0,
            },
            barRequest.hitZone,
            barRequest.range_m,
          );

          const seq = (async (): Promise<void> => {
            await sleep(charge_ms);
            for (let i = 0; i < burst_count; i++) {
              // Re-read aim per shot — the rig may have slewed during
              // the burst (e.g. multi-HP volleys converging on different
              // targets, or a long burst across a moving aim point).
              const aim = slot.getHardpointAim(f.hp.id);
              if (aim === null) {
                // eslint-disable-next-line no-console
                console.warn(
                  `[FireTest] hardpoint "${f.hp.id}" returned null aim ` +
                    `during burst shot ${i + 1}/${burst_count} — ` +
                    `aborting this barrel's burst.`,
                );
                break;
              }
              const shotSpawn: [number, number, number] = [
                aim.position[0],
                aim.position[1],
                aim.position[2],
              ];
              const shotTarget: [number, number, number] = [
                sharedTarget[0],
                sharedTarget[1],
                sharedTarget[2],
              ];
              // FireTestRequest is per-shot; rebuild it with this HP's
              // projectile. We do not await the shot's flight here —
              // the burst pacing is driven by burst_delay_ms, not by
              // the visual flight duration. fts.fire() pushes onto the
              // active-shots pool and resolves when THAT shot's dwell
              // ends; awaiting it would over-stretch the burst by the
              // flight time. We fire-and-forget the visual; the
              // sequencer's burst_delay_ms IS the spacing.
              const request: FireTestRequest = {
                projectile: f.projectile,
                hitZone: barRequest.hitZone,
                range_m: barRequest.range_m,
                time_dilation: barRequest.time_dilation,
              };
              void fts.fire(request, outcome, shotSpawn, shotTarget);

              if (i < burst_count - 1) {
                await sleep(effective_burst_delay_ms);
              }
            }
            await sleep(cooldown_ms);
          })();
          sequencerPromises.push(seq);
        }

        // Wait for every per-HP sequencer to complete its cooldown
        // before re-enabling the Fire button. The user therefore cannot
        // re-press Fire while ANY barrel is still in its charge/burst/
        // cooldown cycle — matches the "real fire-control system"
        // mental model rather than "spam click".
        await Promise.all(sequencerPromises);
      } finally {
        setFireBusy(false);
      }
    },
    [refreshHpHud, resolveWeaponPart, loadProjectileForWeapon],
  );

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------
  return (
    <div style={containerStyle}>
      <div ref={containerRef} style={canvasWrapStyle} />
      <FireTestController
        onFire={handleFire}
        busy={fireBusy}
        onAimChange={handleAimChange}
        hardpoints={unit.hardpoints ?? []}
        unit={unit}
        onSelectedHardpointsChange={setFireSelectedHardpointIds}
      />
      <div style={hudStyle} aria-hidden>
        <div style={hudTitleStyle}>BATTLEFIELD PREVIEW</div>
        <div style={hudRowStyle}>
          <span style={hudDimStyle}>FPS</span>
          <span style={hudValueStyle}>{fps || "—"}</span>
        </div>
        <div style={hudRowStyle}>
          <span style={hudDimStyle}>UNIT</span>
          <span style={hudValueStyle}>{unit.name || unit.id || "—"}</span>
        </div>
        <div style={hudRowStyle}>
          <span style={hudDimStyle}>SRC</span>
          <span style={hudValueStyle}>{srcMode}</span>
        </div>
        <div style={hudRowStyle}>
          <span style={hudDimStyle}>SKIN</span>
          <span style={hudValueStyle}>{skinOn ? "on" : "off"}</span>
        </div>
      </div>
      <div style={hpHudStyle} data-testid="hp-debug-hud" aria-hidden>
        <div style={hpHudTitleStyle}>HP DEBUG</div>
        <div>
          {hpHud.selectedCount}/{hpHud.totalCount} selected
        </div>
        {hpHud.id === null ? (
          <div style={hudDimStyle}>no hardpoint detail</div>
        ) : (
          <>
            <div>id: {hpHud.id}</div>
            <div>pos: {fmtTriple(hpHud.pos, 3)}</div>
            <div>dir: {fmtTriple(hpHud.dir, 3)}</div>
            <div>
              eul: {hpHud.pitchDeg !== null ? hpHud.pitchDeg.toFixed(1) : "—"},{" "}
              {hpHud.yawDeg !== null ? hpHud.yawDeg.toFixed(1) : "—"}, —
            </div>
            <div style={hudDimStyle}>(pitch/yaw/roll)</div>
          </>
        )}
        <div style={hudDimStyle}>
          (at rest — last update: {hpHud.lastEvent ?? "—"})
        </div>
      </div>
    </div>
  );
}
