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
import { query, hasComponent } from "bitecs";

import { SimRunner } from "../sim/simRunner";
import {
  Dead,
  Health,
  Position,
  Rotation,
  TeamId,
  UnitTypeId,
  WeaponInstanceTag,
  type SimWorld,
} from "../sim/world";
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
import { ProjectileRenderer } from "./scene/combat/ProjectileRenderer";
import { CombatVfxManager } from "./scene/combat/CombatVfxManager";
import type { ProjectileSchematic } from "../types/projectile";
import type { ArmorZone, ZoneArmor } from "../types/vulnerability";

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
  team0Alive: number;
  team1Alive: number;
  team0Dead: number;
  team1Dead: number;
  activeProjectiles: number;
  matchWinner: number | null;
}

const PER_TYPE_SPAWN_COUNT = 3;
const TEAM_0 = 0;
const TEAM_1 = 1;
const TEAM_SPACING_M = 60;

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
    team0Alive: 0,
    team1Alive: 0,
    team0Dead: 0,
    team1Dead: 0,
    activeProjectiles: 0,
    matchWinner: null,
  });
  const [damageNumbers, setDamageNumbers] = useState<
    { id: number; value: number; x: number; y: number; z: number; bornMs: number }[]
  >([]);

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

    // Week 3 — TWO teams spawn 60m apart along Z so they face each
    // other along the X axis. Team 0 (blue) on -X side facing +X;
    // Team 1 (red) on +X side facing -X. Default Stance is
    // Defensive — they engage automatically.
    const centerX = terrain.widthM / 2;
    const centerZ = terrain.depthM / 2;
    const team0Count = spawnInitialUnits(
      sim.world,
      match.typeRegistry,
      match.prefabBank,
      unitRenderer,
      {
        perTypeCount: PER_TYPE_SPAWN_COUNT,
        teamId: TEAM_0,
        originX: centerX - TEAM_SPACING_M / 2,
        originZ: centerZ,
      },
      heightAt,
      match.projectileRegistry,
      match.schematics,
      Math.PI / 2, // yaw 90° → face +X (toward team 1)
    );
    const team1Count = spawnInitialUnits(
      sim.world,
      match.typeRegistry,
      match.prefabBank,
      unitRenderer,
      {
        perTypeCount: PER_TYPE_SPAWN_COUNT,
        teamId: TEAM_1,
        originX: centerX + TEAM_SPACING_M / 2,
        originZ: centerZ,
      },
      heightAt,
      match.projectileRegistry,
      match.schematics,
      -Math.PI / 2, // yaw -90° → face -X (toward team 0)
    );
    const spawnedCount = team0Count + team1Count;
    console.info(
      `[GameRuntime] spawned ${spawnedCount} entities (team 0: ${team0Count}, team 1: ${team1Count}) across ${match.typeRegistry.size()} unit type(s).`,
    );

    // --- Combat bindings ---------------------------------------------
    // Pure callbacks the sim uses to resolve runtime-side data
    // (projectile schematics, target armor zones, weapon muzzle
    // positions). Wired up here because they bridge sim ↔ runtime.
    const tmpQuat = new THREE.Quaternion();
    const tmpVec = new THREE.Vector3();
    const lookupProjectile = (typeId: number): ProjectileSchematic | undefined => {
      return match.projectileRegistry.byId(typeId)?.schematic;
    };
    const lookupZoneArmor = (
      unitEid: number,
      zone: ArmorZone,
    ): ZoneArmor | undefined => {
      const tid = UnitTypeId.value[unitEid];
      const entry = match.typeRegistry.byId(tid);
      if (!entry) return undefined;
      const s = match.schematics.find((x) => x.unit.id === entry.schematicId);
      const v = s?.unit.vulnerability;
      if (!v) return undefined;
      return v.armor_zones[zone];
    };
    const resolveMuzzle = (
      ownerEid: number,
      hardpointIdx: number,
    ): { x: number; y: number; z: number; fx: number; fz: number } => {
      const tid = UnitTypeId.value[ownerEid];
      const entry = match.typeRegistry.byId(tid);
      const schem = entry
        ? match.schematics.find((x) => x.unit.id === entry.schematicId)?.unit
        : undefined;
      const hp = schem?.hardpoints?.[hardpointIdx];
      const ox = Position.x[ownerEid];
      const oy = Position.y[ownerEid];
      const oz = Position.z[ownerEid];
      tmpQuat.set(
        Rotation.x[ownerEid],
        Rotation.y[ownerEid],
        Rotation.z[ownerEid],
        Rotation.w[ownerEid],
      );
      let lx = 0;
      let ly = 1;
      let lz = 0;
      if (hp) {
        lx = hp.local_position[0];
        ly = hp.local_position[1];
        lz = hp.local_position[2];
      }
      tmpVec.set(lx, ly, lz).applyQuaternion(tmpQuat);
      const wx = ox + tmpVec.x;
      const wy = oy + tmpVec.y;
      const wz = oz + tmpVec.z;
      // Forward axis in world: rotate (0,0,1) by quaternion.
      const fx = 2 * (Rotation.x[ownerEid] * Rotation.z[ownerEid] +
        Rotation.w[ownerEid] * Rotation.y[ownerEid]);
      const fz = 1 - 2 * (Rotation.x[ownerEid] * Rotation.x[ownerEid] +
        Rotation.y[ownerEid] * Rotation.y[ownerEid]);
      const flen = Math.hypot(fx, fz) || 1;
      return { x: wx, y: wy, z: wz, fx: fx / flen, fz: fz / flen };
    };
    sim.setCombatBindings({
      resolveMuzzle,
      lookupProjectile,
      lookupZoneArmor,
    });

    // --- Combat VFX --------------------------------------------------
    const projRenderer = new ProjectileRenderer();
    scene.add(projRenderer.group);
    const vfx = new CombatVfxManager();
    scene.add(vfx.group);

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

      // Drain sim events → VFX manager. Events accumulate during
      // sim ticks; we consume them here in render order so muzzle
      // flashes appear the same frame the shot was fired.
      const drained = sim.events.drainAll();
      vfx.ingest(drained);
      vfx.update();
      vfx.pruneDamageNumbers(performance.now(), 800);

      // ECS → InstancedMesh sync + InstanceIndex rebuild for selection.
      runUnitRenderSystem(sim.world, unitRenderer, instanceIndex);
      projRenderer.update(sim.world);
      renderer.render(scene, camera);

      fpsAccum += dtReal;
      fpsFrames++;
      if (nowSec - lastHudPushSec > 0.25) {
        const fps = fpsFrames / Math.max(fpsAccum, 1e-6);
        fpsAccum = 0;
        fpsFrames = 0;
        lastHudPushSec = nowSec;
        const tally = tallyTeams(sim.world);
        let winner: number | null = null;
        if (
          spawnedCount > 0 &&
          (tally.team0Alive === 0 || tally.team1Alive === 0)
        ) {
          winner = tally.team0Alive > 0 ? TEAM_0 : TEAM_1;
        }
        setHud((h) => ({
          ...h,
          tick: sim.clock.tickId,
          fps,
          simStepsThisFrame: stepsThisFrame,
          unitTypesRegistered: unitRenderer.typeCount(),
          prefabsCached: match.prefabBank.size(),
          entities: spawnedCount,
          team0Alive: tally.team0Alive,
          team1Alive: tally.team1Alive,
          team0Dead: tally.team0Dead,
          team1Dead: tally.team1Dead,
          activeProjectiles: tally.activeProjectiles,
          matchWinner: winner,
        }));
        // Surface current damage numbers to the HUD overlay.
        const dn = vfx.getDamageNumbers();
        setDamageNumbers(dn.map((d) => ({
          id: d.id,
          value: d.value,
          x: d.x,
          y: d.y,
          z: d.z,
          bornMs: d.bornMs,
        })));
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
      projRenderer.dispose();
      vfx.dispose();
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
        <div style={{ color: "#9cccff" }}>
          Team 0 (blue): {hud.team0Alive} alive · {hud.team0Dead} dead
        </div>
        <div style={{ color: "#ff8c7c" }}>
          Team 1 (red):  {hud.team1Alive} alive · {hud.team1Dead} dead
        </div>
        <div>Projectiles: {hud.activeProjectiles}</div>
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
      {/* Floating damage numbers (HUD overlay — world→screen handled
          by a simple percentage approximation; v1 visible because the
          camera is roughly top-down). v2 will project through the
          camera matrix for accuracy. */}
      <DamageNumberOverlay numbers={damageNumbers} />
      {hud.matchWinner !== null ? (
        <MatchEndOverlay winner={hud.matchWinner} onExit={onExit} />
      ) : null}
    </div>
  );
}

interface DamageNumberOverlayProps {
  readonly numbers: readonly {
    id: number;
    value: number;
    x: number;
    y: number;
    z: number;
    bornMs: number;
  }[];
}

/**
 * v1: render damage numbers as a stack in the top-left corner. Proper
 * world-to-screen projection lands when the HUD layer has access to
 * the camera (Week 4 polish). For now the floating-number feel comes
 * from the recent-history list with a fade-out via CSS.
 */
function DamageNumberOverlay(
  props: DamageNumberOverlayProps,
): React.JSX.Element {
  const now = performance.now();
  const visible = props.numbers
    .filter((d) => now - d.bornMs < 1200)
    .slice(-10);
  return (
    <div style={DAMAGE_OVERLAY_STYLE} aria-hidden>
      {visible.map((d) => {
        const age = (now - d.bornMs) / 1200;
        const opacity = Math.max(0, 1 - age);
        return (
          <div
            key={d.id}
            style={{
              opacity,
              color: "#ffd05a",
              font: "bold 14px ui-monospace, SFMono-Regular, Menlo, monospace",
              textShadow: "1px 1px 0 #000",
            }}
          >
            -{d.value.toFixed(1)}
          </div>
        );
      })}
    </div>
  );
}

interface MatchEndOverlayProps {
  readonly winner: number;
  readonly onExit: () => void;
}

function MatchEndOverlay(props: MatchEndOverlayProps): React.JSX.Element {
  const teamColor =
    props.winner === 0 ? "#9cccff" : props.winner === 1 ? "#ff8c7c" : "#cfd8e3";
  return (
    <div style={MATCH_END_STYLE}>
      <div style={{ font: "bold 24px ui-sans-serif, system-ui", color: teamColor }}>
        Team {props.winner} wins
      </div>
      <button type="button" onClick={props.onExit} style={EXIT_BUTTON_STYLE}>
        Exit Match
      </button>
    </div>
  );
}

/**
 * Resample terrain Y under each renderable entity so the visible mesh
 * stays glued to the ground. Lives in the render loop because the
 * heightmap is a render-side resource; the sim's movementSystem
 * deliberately leaves Y alone. Skips weapon instances + projectiles
 * (projectiles have their own ballistic Y, weapons inherit owner).
 */
function resampleGroundedY(
  world: SimWorld,
  heightAt: (x: number, z: number) => number,
): void {
  const ents = query(world, [Position, Health]);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    if (hasComponent(world, eid, WeaponInstanceTag)) continue;
    Position.y[eid] = heightAt(Position.x[eid], Position.z[eid]);
  }
}

/** Count alive + dead units per team, plus active projectile count. */
function tallyTeams(world: SimWorld): {
  team0Alive: number;
  team1Alive: number;
  team0Dead: number;
  team1Dead: number;
  activeProjectiles: number;
} {
  let t0a = 0;
  let t1a = 0;
  let t0d = 0;
  let t1d = 0;
  const ents = query(world, [TeamId, Health]);
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    if (hasComponent(world, eid, WeaponInstanceTag)) continue;
    const team = TeamId.value[eid];
    const dead = hasComponent(world, eid, Dead) || Health.current[eid] <= 0;
    if (team === 0) {
      if (dead) t0d++;
      else t0a++;
    } else if (team === 1) {
      if (dead) t1d++;
      else t1a++;
    }
  }
  let proj = 0;
  // Count projectiles cheaply: query the ProjectileTag-bearing entities.
  const allPos = query(world, [Position]);
  for (let i = 0; i < allPos.length; i++) {
    const eid = allPos[i];
    if (hasComponent(world, eid, Health)) continue;
    if (hasComponent(world, eid, WeaponInstanceTag)) continue;
    // Anything with Position but no Health and not a weapon → projectile.
    proj++;
  }
  return {
    team0Alive: t0a,
    team1Alive: t1a,
    team0Dead: t0d,
    team1Dead: t1d,
    activeProjectiles: proj,
  };
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

const DAMAGE_OVERLAY_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  padding: "4px 8px",
  background: "rgba(0,0,0,0.4)",
  borderRadius: 3,
  pointerEvents: "none",
  display: "flex",
  flexDirection: "column",
  gap: 1,
  minWidth: 70,
};

const MATCH_END_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  padding: "24px 32px",
  background: "rgba(0,0,0,0.85)",
  border: "1px solid #2a2a2f",
  borderRadius: 6,
  textAlign: "center",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  alignItems: "center",
  pointerEvents: "auto",
};
