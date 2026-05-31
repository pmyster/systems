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

import { resolveInteraction } from "../../lib/resolve-interaction";
import { getEffectiveTarget } from "../../lib/fire-test/simulator";
import type { FireTestRequest } from "../../lib/fire-test/types";
import { MAP_SIZE_M } from "../../lib";
import { useMeshAssets } from "../../state/mesh-assets";
import type { ProjectileSchematic, UnitSchematic } from "../../types";

import { attachControls, type ControlsHandle } from "./controls";
import { FireTestController } from "./FireTestController";
import {
  createFireTestScene,
  type FireTestSceneHandle,
} from "./FireTestScene";
import { buildBattlefieldScene, type BattlefieldScene } from "./scene";
import {
  createUnitOnTerrain,
  type UnitOnTerrainHandle,
} from "./unit-on-terrain";

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
}

const HP_HUD_EMPTY: HpHudSnapshot = {
  id: null,
  pos: null,
  dir: null,
  pitchDeg: null,
  yawDeg: null,
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
  const { meshSource, skinImage } = useMeshAssets();

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
  }, [unit.hardpoints]);

  // -------------------------------------------------------------------------
  // HP DEBUG HUD: per-frame poll of the FIRST hardpoint's world aim.
  //
  // The user cannot open DevTools; this overlay is the only window into
  // whether the hardpoint's pos/dir is actually tracking the document. A
  // RAF loop reads `getHardpointAim` each frame and only commits to React
  // state when at least one tracked value has changed at display precision
  // (3 decimals for pos/dir). This caps re-renders at a few per second
  // during gizmo drags and to zero when the unit is idle.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    let running = true;

    // Last snapshot we PUSHED to React. We compare next-frame values
    // against this rounded representation to throttle re-renders.
    let lastId: string | null = null;
    let lastPx = NaN;
    let lastPy = NaN;
    let lastPz = NaN;
    let lastDx = NaN;
    let lastDy = NaN;
    let lastDz = NaN;

    const round3 = (n: number): number => Math.round(n * 1000) / 1000;

    const sample = () => {
      if (!running) return;
      raf = requestAnimationFrame(sample);

      const slot = unitSlotRef.current;
      const currentUnit = unitRef.current;
      const firstHp = currentUnit.hardpoints?.[0];

      if (!slot || !firstHp) {
        if (lastId !== null) {
          lastId = null;
          lastPx = lastPy = lastPz = NaN;
          lastDx = lastDy = lastDz = NaN;
          setHpHud(HP_HUD_EMPTY);
        }
        return;
      }

      const aim = slot.getHardpointAim(firstHp.id);
      if (!aim) {
        if (lastId !== null) {
          lastId = null;
          lastPx = lastPy = lastPz = NaN;
          lastDx = lastDy = lastDz = NaN;
          setHpHud(HP_HUD_EMPTY);
        }
        return;
      }

      const px = round3(aim.position[0]);
      const py = round3(aim.position[1]);
      const pz = round3(aim.position[2]);
      const dx = round3(aim.direction[0]);
      const dy = round3(aim.direction[1]);
      const dz = round3(aim.direction[2]);

      if (
        firstHp.id === lastId &&
        px === lastPx &&
        py === lastPy &&
        pz === lastPz &&
        dx === lastDx &&
        dy === lastDy &&
        dz === lastDz
      ) {
        return;
      }

      lastId = firstHp.id;
      lastPx = px;
      lastPy = py;
      lastPz = pz;
      lastDx = dx;
      lastDy = dy;
      lastDz = dz;

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
        id: firstHp.id,
        pos: [px, py, pz],
        dir: [dx, dy, dz],
        pitchDeg,
        yawDeg,
      });
    };

    raf = requestAnimationFrame(sample);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

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
    // We pick the first hardpoint whose id is currently mounted on the
    // slot — typically the only one a single-weapon unit has. A future
    // FireTestController slice can surface a picker for multi-hardpoint
    // units; until then "first" is enough to validate the placement.
    const hardpoints = currentUnit.hardpoints ?? [];
    if (slot && hardpoints.length > 0) {
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

  const handleAimChange = useCallback(
    (projectile: ProjectileSchematic | null, range_m: number): void => {
      const fts = fireTestRef.current;
      if (!fts) return;
      if (!projectile) {
        fts.reset();
        // No projectile picked → no aim target → reactive muzzle rigs
        // resume their default ping-pong sweep.
        unitSlotRef.current?.setAimTarget(null);
        return;
      }
      const { spawn, direction } = computeAim();
      const target = getEffectiveTarget(
        spawn,
        direction,
        range_m,
        projectile.delivery_params.kind,
      );
      fts.setTargetMarker(spawn, target);
      // Push the world-space aim target into the unit slot so reactive
      // muzzle rigs slew their yaw/pitch toward it. The rig animation
      // tick consumes this each frame; passive/non-muzzle rigs ignore it.
      unitSlotRef.current?.setAimTarget(target);
    },
    [computeAim],
  );

  const handleFire = useCallback(
    async (request: FireTestRequest): Promise<void> => {
      const fts = fireTestRef.current;
      if (!fts) return;
      const currentUnit = unitRef.current;
      // Match InteractionTester behaviour exactly — same fields, same
      // fallback. The brief requires identical outcome text for the
      // same inputs.
      const outcome = resolveInteraction(
        request.projectile,
        {
          vulnerability: currentUnit.vulnerability,
          thermal_cap_mj: currentUnit.chassis.thermal_capacity_MJ ?? 0,
        },
        request.hitZone,
        request.range_m,
      );
      // Re-aim the marker right before firing in case the controller's
      // local state lagged the live broadcast (e.g. very rapid clicks).
      // First pass uses the rig's CURRENT pose to project an initial target;
      // we then push that target into the unit slot, snap the rig to it
      // (skipping the rate-limited slew), and recompute spawn+direction
      // from the now-on-target pose. This makes Fire feel instant — the
      // projectile spawns from the would-be-when-arrived angle, even if
      // the visible rig is still slewing into place.
      const initial = computeAim();
      const initialTarget = getEffectiveTarget(
        initial.spawn,
        initial.direction,
        request.range_m,
        request.projectile.delivery_params.kind,
      );
      unitSlotRef.current?.setAimTarget(initialTarget);
      unitSlotRef.current?.snapAimToTarget();
      // LIVE-READ: re-derive spawn+direction from the unit's CURRENT state
      // immediately before the shot. Any hardpoint edit since the last
      // aim-change is now visible — no cached aim ever leaks into fire().
      const { spawn, direction } = computeAim();
      const target = getEffectiveTarget(
        spawn,
        direction,
        request.range_m,
        request.projectile.delivery_params.kind,
      );
      // Marker visualisation only — fire() itself will use the fresh
      // spawn/target we pass below, not anything cached here.
      fts.setTargetMarker(spawn, target);

      setFireBusy(true);
      try {
        await fts.fire(request, outcome, spawn, target);
      } finally {
        setFireBusy(false);
      }
    },
    [computeAim],
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
        {hpHud.id === null ? (
          <div>no hardpoint</div>
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
      </div>
    </div>
  );
}
