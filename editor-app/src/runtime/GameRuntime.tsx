/**
 * GameRuntime — Phase 1 Week 2 view.
 *
 * Two-state view:
 *
 *   1. MatchSetupScreen — Pick Map → Pick Units → Load Match → progress bar.
 *      The 5-phase MatchLoader runs and emits LoadProgress; on completion
 *      we transition to:
 *
 *   2. MatchScene — Three.js scene with the loaded RuntimeTerrain, a hemi
 *      + sun lighting rig, the InstancedUnitRenderer, the RtsCamera, the
 *      SelectionController, the CommandController, and an async navmesh
 *      bake feeding the PathFollowController. RuntimePhysics is held but
 *      not stepped (Rapier integration arrives Week 3).
 *
 * Architectural notes (rules locked by the brief):
 *   - `/sim` stays headless: only this view (and the runtime-side
 *     controllers) import Three.js / Rapier / recast.
 *   - Wall-clock time enters the sim ONLY through `sim.advance(nowSec)`.
 *   - Cleanup is exhaustive: every Three.js + Rapier + recast resource
 *     has a matched dispose() in the unmount path.
 *
 * Week 2 add (above Week 1B):
 *   - RtsCamera replaces FreeFlyCamera.
 *   - SelectionController + CommandController bound to the canvas.
 *   - NavMeshBaker runs async; "Building navmesh…" overlay until done.
 *   - PathFollowController owns per-entity waypoint queues; the RAF
 *     loop calls pollArrivals() each frame to advance waypoints.
 *   - HUD adds Selected: N and Navmesh: building/ready/failed.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { query } from "bitecs";

import { SimRunner } from "../sim/simRunner";
import { Position, type SimWorld } from "../sim/world";
import { RtsCamera } from "./scene/RtsCamera";
import { MatchSetupScreen } from "./MatchSetupScreen";
import type { MatchData } from "./MatchLoader";
import { RuntimeTerrain } from "./scene/RuntimeTerrain";
import { InstancedUnitRenderer } from "./scene/InstancedUnitRenderer";
import { InstanceIndex, runUnitRenderSystem } from "./scene/UnitRenderSystem";
import { RuntimePhysics } from "./physics/RuntimePhysics";
import { spawnInitialUnits } from "./spawning/MatchSpawner";
import { bakeNavMesh, type NavMeshHandle } from "./pathfinding/NavMeshBaker";
import { PathFollowController } from "./pathfinding/PathFollowController";
import { SelectionController } from "./input/SelectionController";
import { CommandController } from "./input/CommandController";

const HZ = 30;
const SEED = 42;

type NavMeshStatus = "building" | "ready" | "failed";

interface HudReadout {
  tick: number;
  fps: number;
  simStepsThisFrame: number;
  unitTypesRegistered: number;
  prefabsCached: number;
  entities: number;
  selected: number;
  navMeshStatus: NavMeshStatus;
  navMeshError?: string;
}

const PER_TYPE_SPAWN_COUNT = 5;
const SPAWN_TEAM_ID = 0;

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
    entities: 0,
    selected: 0,
    navMeshStatus: "building",
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // --- Three.js scene --------------------------------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a2030);

    // --- Terrain ---------------------------------------------------------
    const terrain = new RuntimeTerrain(match.map);
    scene.add(terrain.mesh);

    // --- Physics ---------------------------------------------------------
    const physics = new RuntimePhysics(match.map);

    // --- Lighting --------------------------------------------------------
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
    // Initial framing is overridden by the RtsCamera as soon as it
    // constructs (which sets pos+lookAt from focus/yaw/pitch/distance),
    // but we still set something sensible in case the controller
    // construction throws.
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

    // Disable the browser context menu so right-click is reserved
    // for the CommandController.
    const onContextMenu = (e: Event): void => e.preventDefault();
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const rtsCamera = new RtsCamera({
      camera,
      domElement: renderer.domElement,
      bounds: {
        minX: 0,
        maxX: terrain.widthM,
        minZ: 0,
        maxZ: terrain.depthM,
      },
      initialFocus: new THREE.Vector3(
        terrain.widthM / 2,
        0,
        terrain.depthM / 2,
      ),
      edgePanEnabled: true,
    });

    // --- Unit Instances --------------------------------------------------
    const unitRenderer = new InstancedUnitRenderer();
    scene.add(unitRenderer.group);
    const instanceIndex = new InstanceIndex();

    // --- Sim -------------------------------------------------------------
    const sim = new SimRunner({ hz: HZ, seed: SEED });

    // --- Initial spawn ---------------------------------------------------
    const tileM = match.map.manifest.terrain.tileSizeM ?? 1;
    const heightWpx = match.map.manifest.terrain.widthPx;
    const heightHpx = match.map.manifest.terrain.heightPx;
    const heightmap = match.map.heightmap;
    const heightAt = (worldX: number, worldZ: number): number => {
      const fx = Math.max(0, Math.min(heightWpx - 1, worldX / tileM));
      const fz = Math.max(0, Math.min(heightHpx - 1, worldZ / tileM));
      const c0 = Math.floor(fx);
      const r0 = Math.floor(fz);
      const c1 = Math.min(heightWpx - 1, c0 + 1);
      const r1 = Math.min(heightHpx - 1, r0 + 1);
      const tx = fx - c0;
      const tz = fz - r0;
      const h00 = heightmap[r0 * heightWpx + c0];
      const h10 = heightmap[r0 * heightWpx + c1];
      const h01 = heightmap[r1 * heightWpx + c0];
      const h11 = heightmap[r1 * heightWpx + c1];
      const a = h00 * (1 - tx) + h10 * tx;
      const b = h01 * (1 - tx) + h11 * tx;
      return a * (1 - tz) + b * tz;
    };

    const spawnedCount = spawnInitialUnits(
      sim.world,
      match.typeRegistry,
      match.prefabBank,
      unitRenderer,
      {
        perTypeCount: PER_TYPE_SPAWN_COUNT,
        teamId: SPAWN_TEAM_ID,
        originX: terrain.widthM / 2,
        originZ: terrain.depthM / 2,
      },
      heightAt,
    );
    console.info(
      `[GameRuntime] spawned ${spawnedCount} entities across ${match.typeRegistry.size()} unit type(s).`,
    );

    // --- Navmesh bake + path follower (async) ---------------------------
    let navHandle: NavMeshHandle | null = null;
    let pathFollower: PathFollowController | null = null;
    let selection: SelectionController | null = null;
    let command: CommandController | null = null;
    let disposed = false;

    bakeNavMesh(terrain.mesh)
      .then((handle) => {
        if (disposed) {
          handle.dispose();
          return;
        }
        navHandle = handle;
        pathFollower = new PathFollowController(sim.world, handle);

        selection = new SelectionController({
          world: sim.world,
          camera,
          domElement: renderer.domElement,
          unitsGroup: unitRenderer.group,
          instanceLookup: (mesh, instanceId) =>
            instanceIndex.lookup(mesh, instanceId),
          onSelectionChanged: (sel) => {
            // HUD update on selection change is decoupled from the
            // RAF FPS tick — keeps the count fresh without thrashing.
            setHud((h) => ({ ...h, selected: sel.length }));
          },
        });
        command = new CommandController({
          camera,
          domElement: renderer.domElement,
          terrainMesh: terrain.mesh,
          commands: sim.commands,
          clock: sim.clock,
          selection,
          pathFollower,
          cursorTarget: renderer.domElement,
        });
        setHud((h) => ({ ...h, navMeshStatus: "ready" }));
      })
      .catch((err: unknown) => {
        if (disposed) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[GameRuntime] navmesh bake failed", err);
        setHud((h) => ({
          ...h,
          navMeshStatus: "failed",
          navMeshError: msg,
        }));
      });

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

      // RTS camera (real wall-clock seconds).
      rtsCamera.update(dtReal);

      // Path waypoint advancement — runs after the sim because
      // arrival is signaled by the sim writing hasTarget = 0.
      if (pathFollower) pathFollower.pollArrivals();

      // Re-sample terrain height under each entity so units sit on
      // the ground despite the sim's planar X/Z movement. The sample
      // is render-side because the heightmap is a /runtime concept.
      // (Cheap: ≤ ~100 entities per Phase 1 budget.)
      resampleGroundedY(sim.world, heightAt);

      // ECS → InstancedMesh sync + InstanceIndex rebuild for selection.
      runUnitRenderSystem(sim.world, unitRenderer, instanceIndex);
      renderer.render(scene, camera);

      fpsAccum += dtReal;
      fpsFrames++;
      if (nowSec - lastHudPushSec > 0.25) {
        const fps = fpsFrames / Math.max(fpsAccum, 1e-6);
        fpsAccum = 0;
        fpsFrames = 0;
        lastHudPushSec = nowSec;
        setHud((h) => ({
          ...h,
          tick: sim.clock.tickId,
          fps,
          simStepsThisFrame: stepsThisFrame,
          unitTypesRegistered: unitRenderer.typeCount(),
          prefabsCached: match.prefabBank.size(),
          entities: spawnedCount,
        }));
      }
    };
    frame();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      command?.dispose();
      selection?.dispose();
      pathFollower?.dispose();
      navHandle?.dispose();
      rtsCamera.dispose();
      unitRenderer.dispose();
      terrain.dispose();
      physics.dispose();
      match.prefabBank.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
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
        <div>Entities: {hud.entities}</div>
        <div>Selected: {hud.selected}</div>
        <div>
          Navmesh: {hud.navMeshStatus}
          {hud.navMeshError ? ` (${hud.navMeshError})` : ""}
        </div>
        <div>Sim steps/frame: {hud.simStepsThisFrame}</div>
        <button type="button" onClick={onExit} style={EXIT_BUTTON_STYLE}>
          Exit Match
        </button>
      </div>
      {hud.navMeshStatus === "building" ? (
        <div style={NAVMESH_OVERLAY_STYLE}>Building navmesh…</div>
      ) : null}
    </div>
  );
}

/**
 * Resample terrain Y under each renderable entity so the visible mesh
 * stays glued to the ground. Lives in the render loop because the
 * heightmap is a render-side resource; the sim's movementSystem
 * deliberately leaves Y alone.
 */
function resampleGroundedY(
  world: SimWorld,
  heightAt: (x: number, z: number) => number,
): void {
  const ents = query(world, [Position]);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    Position.y[eid] = heightAt(Position.x[eid], Position.z[eid]);
  }
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

const NAVMESH_OVERLAY_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  padding: "12px 20px",
  background: "rgba(0,0,0,0.75)",
  color: "#cfd8e3",
  border: "1px solid #2a2a2f",
  borderRadius: 4,
  font: "13px ui-monospace, SFMono-Regular, Menlo, monospace",
  pointerEvents: "none",
  userSelect: "none",
};
