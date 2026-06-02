/**
 * GameRuntime — Week 1A foundation view.
 *
 * Role in the architecture: the THIN VIEW over the headless `/sim`.
 *
 *   sim (headless TS) ──▶ GameRuntime (Three.js + DOM) ──▶ pixels
 *
 * The view never owns gameplay state. It:
 *   1. Constructs a `SimRunner` (the single source of truth).
 *   2. On every animation frame:
 *        a. Calls `sim.advance(performance.now() / 1000)` — ONE call,
 *           the determinism boundary; `performance.now()` lives here,
 *           NOT inside /sim.
 *        b. Renders the Three.js scene.
 *   3. Owns the camera, renderer, and the HUD overlay.
 *
 * Day-1 visible content is a 128 m grid at y=0 and a free-fly camera.
 * No units, no map. That is INTENTIONAL — the goal of this slice is
 * proving the wiring, not the gameplay.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SimRunner } from "../sim/simRunner";
import { FreeFlyCamera } from "./FreeFlyCamera";

const GRID_SIZE_M = 128;
const GRID_DIVISIONS = 64;        // 2 m cells — coarse enough to read at altitude
const HZ = 30;                    // matches the rest of /sim's expectations
const SEED = 42;                  // arbitrary; will be wired to match metadata later

/** Small mutable HUD model — re-rendered via setState at a throttled cadence. */
interface HudReadout {
  tick: number;
  fps: number;
  simStepsThisFrame: number;
}

export function GameRuntime(): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [hud, setHud] = useState<HudReadout>({ tick: 0, fps: 0, simStepsThisFrame: 0 });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // --- Three.js setup ---------------------------------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101014);

    const camera = new THREE.PerspectiveCamera(
      60,
      mount.clientWidth / Math.max(1, mount.clientHeight),
      0.1,
      2000,
    );
    camera.position.set(32, 28, 32);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    // Grid floor — visually anchors the empty world so camera motion reads.
    // Subdivision-aligned coloring (major lines lighter than minor).
    const grid = new THREE.GridHelper(GRID_SIZE_M, GRID_DIVISIONS, 0x3a6e3a, 0x222226);
    scene.add(grid);

    // Hemisphere light is enough for an untextured grid scene; PBR comes
    // later when actual unit meshes are rendered.
    const hemi = new THREE.HemisphereLight(0xbcd9ff, 0x202020, 1.0);
    scene.add(hemi);

    // --- Camera + sim -----------------------------------------------------
    const fly = new FreeFlyCamera(camera, renderer.domElement);
    const sim = new SimRunner({ hz: HZ, seed: SEED });

    // --- Resize -----------------------------------------------------------
    const onResize = (): void => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = Math.max(1, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    // ResizeObserver covers the case where the parent pane changes size
    // without a window resize (e.g. devtools open).
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    // --- Animation loop ---------------------------------------------------
    let rafId = 0;
    let lastFrameSec = performance.now() / 1000;
    let fpsAccum = 0;
    let fpsFrames = 0;
    let lastHudPushSec = lastFrameSec;
    let lastFps = 0;

    const frame = (): void => {
      rafId = requestAnimationFrame(frame);
      const nowSec = performance.now() / 1000;
      const dtReal = nowSec - lastFrameSec;
      lastFrameSec = nowSec;

      // 1. Drive the sim. THIS is the only place wall-clock crosses into /sim.
      const stepsThisFrame = sim.advance(nowSec);

      // 2. Update presentation-only state.
      fly.update(dtReal);

      // 3. Render.
      renderer.render(scene, camera);

      // 4. HUD throttling — recompute FPS every ~250 ms so the number is readable.
      fpsAccum += dtReal;
      fpsFrames++;
      if (nowSec - lastHudPushSec > 0.25) {
        lastFps = fpsFrames / fpsAccum;
        fpsAccum = 0;
        fpsFrames = 0;
        lastHudPushSec = nowSec;
        setHud({
          tick: sim.clock.tickId,
          fps: lastFps,
          simStepsThisFrame: stepsThisFrame,
        });
      }
    };
    frame();

    // --- Cleanup ----------------------------------------------------------
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      fly.dispose();
      // Three.js disposal — these are the leaks-if-skipped resources.
      renderer.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div ref={mountRef} className="game-runtime-root" style={ROOT_STYLE}>
      <div style={HUD_STYLE} aria-label="Runtime HUD">
        <div>Tick: {hud.tick}</div>
        <div>FPS: {hud.fps.toFixed(1)}</div>
        <div>Sim steps/frame: {hud.simStepsThisFrame}</div>
      </div>
    </div>
  );
}

// Inline styles intentionally — this view is fully self-contained, no need
// to thread new classes through App.css for a temporary HUD overlay.
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
  pointerEvents: "none",
  userSelect: "none",
};
