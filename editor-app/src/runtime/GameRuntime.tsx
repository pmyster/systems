/**
 * GameRuntime — Phase 1 Week 1B view.
 *
 * Two-state view:
 *
 *   1. MatchSetupScreen — Pick Map → Pick Units → Load Match → progress bar.
 *      The 5-phase MatchLoader runs and emits LoadProgress; on completion
 *      we transition to:
 *
 *   2. MatchScene — Three.js scene with the loaded RuntimeTerrain, a hemi
 *      + sun lighting rig, the InstancedUnitRenderer (with 0 active
 *      instances; Week 1C populates), and the FreeFlyCamera so the dev can
 *      look around to verify the data loaded. RuntimePhysics is constructed
 *      and held by the scene (no entities yet to step).
 *
 * Architectural notes (rules locked by the brief):
 *   - `/sim` stays headless: only this view imports Three.js + Rapier.
 *   - Wall-clock time enters the sim ONLY through `sim.advance(nowSec)` —
 *     same as Week 1A. No new entry point added.
 *   - Cleanup is exhaustive: every Three.js + Rapier resource we built has a
 *     matched dispose() in the unmount path. The MatchData lives only while
 *     the scene is mounted; setMatch(null) tears it down and returns to
 *     setup so the dev can pick a different match.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { SimRunner } from "../sim/simRunner";
import { FreeFlyCamera } from "./FreeFlyCamera";
import { MatchSetupScreen } from "./MatchSetupScreen";
import type { MatchData } from "./MatchLoader";
import { RuntimeTerrain } from "./scene/RuntimeTerrain";
import { InstancedUnitRenderer, DEFAULT_MAX_INSTANCES_PER_TYPE } from "./scene/InstancedUnitRenderer";
import { RuntimePhysics } from "./physics/RuntimePhysics";

const HZ = 30;
const SEED = 42;

interface HudReadout {
  tick: number;
  fps: number;
  simStepsThisFrame: number;
  unitTypesRegistered: number;
  prefabsCached: number;
}

export function GameRuntime(): React.JSX.Element {
  const [match, setMatch] = useState<MatchData | null>(null);

  if (match === null) {
    return <MatchSetupScreen onLoaded={setMatch} />;
  }

  return (
    <MatchScene
      match={match}
      onExit={() => setMatch(null)}
    />
  );
}

interface MatchSceneProps {
  readonly match: MatchData;
  readonly onExit: () => void;
}

function MatchScene(props: MatchSceneProps): React.JSX.Element {
  const { match, onExit } = props;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [hud, setHud] = useState<HudReadout>({
    tick: 0,
    fps: 0,
    simStepsThisFrame: 0,
    unitTypesRegistered: 0,
    prefabsCached: 0,
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // --- Three.js scene --------------------------------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a2030);

    // --- Terrain ---------------------------------------------------------
    // RuntimeTerrain is render-only — it owns its geometry + material.
    const terrain = new RuntimeTerrain(match.map);
    scene.add(terrain.mesh);

    // --- Physics ---------------------------------------------------------
    // Rapier was warmed up by the MatchLoader; the constructor is synchronous.
    const physics = new RuntimePhysics(match.map);

    // --- Lighting --------------------------------------------------------
    // Defaults per brief: hemi + sun. Biome-baked atmosphere comes later.
    const hemi = new THREE.HemisphereLight(0xbcd9ff, 0x405028, 1.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4dc, 1.8);
    sun.position.set(terrain.widthM * 0.4, 80, terrain.depthM * 0.2);
    scene.add(sun);

    // --- Camera ----------------------------------------------------------
    const camera = new THREE.PerspectiveCamera(
      60,
      mount.clientWidth / Math.max(1, mount.clientHeight),
      0.1,
      Math.max(2000, terrain.widthM * 4),
    );
    // Park the camera so the whole map is visible. Looking diagonally down
    // gives a recognisable RTS-style framing without committing to the
    // future RtsOrbitCamera that lands in Week 2.
    camera.position.set(
      terrain.widthM * 0.5,
      Math.max(40, terrain.widthM * 0.35),
      terrain.depthM * 1.1,
    );
    camera.lookAt(terrain.widthM / 2, 0, terrain.depthM / 2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const fly = new FreeFlyCamera(camera, renderer.domElement);

    // --- Unit Instances --------------------------------------------------
    // Pre-allocate one InstancedMesh per unit type. Slot count is fixed at
    // DEFAULT_MAX_INSTANCES_PER_TYPE per the brief. Week 1C will write into
    // these slots from RenderSystem.
    const unitRenderer = new InstancedUnitRenderer();
    scene.add(unitRenderer.group);

    // typeId assignment: stable in this build, derived from the schematic
    // index. Week 1C will canonicalise this in the EntityFactory.
    let nextTypeId = 0;
    for (const schematic of match.schematics) {
      const ref = schematic.unit.mesh_asset;
      if (!ref) continue;
      const template = match.prefabBank.get(ref);
      if (!template) {
        // The prefab failed to load (already logged by MatchLoader). Skip
        // so the type just doesn't render until reloaded — no crash.
        continue;
      }
      unitRenderer.register(nextTypeId++, template, DEFAULT_MAX_INSTANCES_PER_TYPE);
    }

    // --- Sim -------------------------------------------------------------
    const sim = new SimRunner({ hz: HZ, seed: SEED });

    // --- Resize ----------------------------------------------------------
    const onResize = (): void => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = Math.max(1, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    // --- Animation loop --------------------------------------------------
    let rafId = 0;
    let lastFrameSec = performance.now() / 1000;
    let fpsAccum = 0;
    let fpsFrames = 0;
    let lastHudPushSec = lastFrameSec;

    const frame = (): void => {
      rafId = requestAnimationFrame(frame);
      const nowSec = performance.now() / 1000;
      const dtReal = nowSec - lastFrameSec;
      lastFrameSec = nowSec;

      // Drive the sim — only place wall-clock enters /sim.
      const stepsThisFrame = sim.advance(nowSec);
      // Physics is allocated but not stepped (no bodies yet — Week 1C).
      // This explicit no-op call is intentional: it documents where the
      // physics step will land once entities exist.

      fly.update(dtReal);
      renderer.render(scene, camera);

      fpsAccum += dtReal;
      fpsFrames++;
      if (nowSec - lastHudPushSec > 0.25) {
        const fps = fpsFrames / Math.max(fpsAccum, 1e-6);
        fpsAccum = 0;
        fpsFrames = 0;
        lastHudPushSec = nowSec;
        setHud({
          tick: sim.clock.tickId,
          fps,
          simStepsThisFrame: stepsThisFrame,
          unitTypesRegistered: unitRenderer.typeCount(),
          prefabsCached: match.prefabBank.size(),
        });
      }
    };
    frame();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      fly.dispose();
      // Disposal order: renderer-side first (which holds geometry refs),
      // then the bank that owns the source roots.
      unitRenderer.dispose();
      terrain.dispose();
      physics.dispose();
      match.prefabBank.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // We intentionally remount the entire scene when `match` changes (the
    // outer GameRuntime swaps the component); the effect's dep array can
    // safely be empty because match is captured at first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={mountRef} className="game-runtime-root" style={ROOT_STYLE}>
      <div style={HUD_STYLE} aria-label="Runtime HUD">
        <div>Map: {match.map.manifest.name}</div>
        <div>
          Terrain: {match.map.manifest.terrain.widthPx}×
          {match.map.manifest.terrain.heightPx}
        </div>
        <div>Tick: {hud.tick}</div>
        <div>FPS: {hud.fps.toFixed(1)}</div>
        <div>Unit types: {hud.unitTypesRegistered}</div>
        <div>Prefabs cached: {hud.prefabsCached}</div>
        <div>Sim steps/frame: {hud.simStepsThisFrame}</div>
        <button type="button" onClick={onExit} style={EXIT_BUTTON_STYLE}>
          Exit Match
        </button>
      </div>
    </div>
  );
}

const ROOT_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
};

const HUD_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  padding: "6px 10px",
  background: "rgba(0,0,0,0.65)",
  color: "#cfd8e3",
  font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
  border: "1px solid #2a2a2f",
  borderRadius: 3,
  pointerEvents: "auto",
  userSelect: "none",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const EXIT_BUTTON_STYLE: React.CSSProperties = {
  marginTop: 6,
  padding: "4px 8px",
  background: "#3a1a1a",
  border: "1px solid #6e2d2d",
  borderRadius: 3,
  color: "#ffb0b0",
  font: "inherit",
  cursor: "pointer",
};
