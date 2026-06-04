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
import { spawnInitialUnits, spawnPlacedBuildings } from "./spawning/MatchSpawner";
import { bakeNavMesh, type NavMeshHandle } from "./pathfinding/NavMeshBaker";
import { PathFollowController } from "./pathfinding/PathFollowController";
import { SelectionController } from "./input/SelectionController";
import { CommandController } from "./input/CommandController";
import { ProjectileRenderer } from "./scene/combat/ProjectileRenderer";
import { CombatVfxManager } from "./scene/combat/CombatVfxManager";
import {
  makeClampedHeightSampler,
  makeProjectileHeightSampler,
} from "./loader/heightmapSampler";
import { HpBarRenderer } from "./scene/combat/HpBarRenderer";
import { UNIT_RENDER_SCALE } from "./loader/prefabBank";
import type { ProjectileSchematic } from "../types/projectile";
import type { ArmorZone, ZoneArmor } from "../types/vulnerability";
import { ReplayRecorder } from "./replay/ReplayRecorder";
import { verifyReplayDrift, type ReplaySession } from "./replay/ReplayPlayer";
import { ClipRecorder } from "./recording/ClipRecorder";
import { AudioBus, AudioCue } from "./audio/AudioBus";
import type { SimEvent } from "../sim/events";

const HZ = 30;
const SEED = 42;

type NavMeshStatus = "building" | "ready" | "failed";

interface HudReadout {
  tick: number;
  fps: number;
  simStepsThisFrame: number;
  unitTypesRegistered: number;
  prefabsCached: number;
  /**
   * Total mesh nodes the renderer is driving across all registered types.
   * One InstancedMesh per node — a single-mesh procedural template counts
   * as 1; a 5-barrel turret GLB counts as 1 chassis + 5 barrels = 6.
   * Surfaced in the HUD so the owner can see at a glance whether the
   * prefab's sub-mesh breakdown matches the intended visual.
   */
  weaponPartMeshes: number;
  /**
   * Loud-over-silent accounting triplet:
   *   schematicsLoaded : prefabsRequested : prefabsCached
   *
   * When the three numbers all match, the load chain is intact
   * end-to-end. When they diverge, the HUD row turns orange and the
   * exact mismatch is visible without opening F12. e.g. "1 : 1 : 0"
   * means "the bank was asked to load 1 mesh and ended up with 0
   * cached" → the prefabBank load failed. "1 : 0 : 0" means "the
   * loader had 1 schematic but didn't ask for any prefab" →
   * mesh_asset shape unknown / missing.
   */
  schematicsLoaded: number;
  prefabsRequested: number;
  entities: number;
  selected: number;
  navMeshStatus: NavMeshStatus;
  navMeshError?: string;
  team0Alive: number;
  team1Alive: number;
  team0Dead: number;
  team1Dead: number;
  activeProjectiles: number;
  /**
   * Phase 1 Week 5 — running total of projectile + beam impacts on
   * TERRAIN (not units) since match start. Ticks up every time a hill
   * blocks a shot or a stray round lands in the dirt. Surfaces in the
   * HUD as "Terrain impacts: N" — proof-the-system-works counter so
   * the owner can SEE the heightmap doing real work.
   */
  terrainImpacts: number;
  matchWinner: number | null;
  /**
   * Total number of warnings the MatchLoader + MatchSpawner pushed
   * during the load. > 0 means at least one schematic, prefab, or
   * spawn step was dropped — the HUD chip expands to show the first
   * few messages. Per CLAUDE.md rule #1 (loud over silent): the
   * failure path must surface in a UI bucket, not just the console.
   */
  loadWarningCount: number;
  /**
   * First five warning lines, pre-formatted for the HUD chip. Kept
   * as strings (not the structured LoadWarning) so the HUD doesn't
   * need to know about diagnostics internals.
   */
  loadWarningLines: readonly string[];
}

// One unit per type per team by default. With the 32-unit picker live,
// 32 × 3 = 96-wide per-team stripe overflowed the 129m map; capping at
// 1 keeps the compact-grid formation visible (sqrt(32) ≈ 8×8 block).
const PER_TYPE_SPAWN_COUNT = 1;
const TEAM_0 = 0;
const TEAM_1 = 1;
const TEAM_SPACING_M = 60;

export function GameRuntime(): React.JSX.Element {
  const [match, setMatch] = useState<MatchData | null>(null);
  /**
   * If non-null we're in REPLAY MODE — the loaded session was paired
   * with a matching match config. The MatchScene gates input controllers
   * off, pre-loads the command bus from the session, and runs a drift
   * check when the recorded tick count is reached.
   */
  const [replaySession, setReplaySession] = useState<ReplaySession | null>(null);

  // -------------------------------------------------------------------
  // PrefabBank lifecycle is owned HERE, not in MatchScene's mount effect.
  //
  // Why this isn't in MatchScene's cleanup:
  //   React 19 StrictMode dev-mode runs every effect MOUNT → CLEANUP →
  //   MOUNT. If we disposed the bank in MatchScene's cleanup, the second
  //   mount would find an empty bank → MatchSpawner would log
  //   "no prefab cached for unit type X" → 0 entities spawn. The bank
  //   belongs to `match` state (lives in GameRuntime), so its lifecycle
  //   must match `match` — disposed when `match` is REPLACED or this
  //   component itself unmounts, not when the child re-mounts.
  //
  // CLAUDE.md rule (loud over silent): the prior silent failure was a
  // child cleanup mutating parent-owned state. Pinning the owner of
  // the resource to the owner of the data fixes the class of bug.
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!match) return;
    return () => {
      match.prefabBank.dispose();
    };
  }, [match]);

  if (match === null) {
    return (
      <MatchSetupScreen
        onLoaded={(m, session) => {
          setMatch(m);
          setReplaySession(session ?? null);
        }}
      />
    );
  }

  return (
    <MatchScene
      match={match}
      replaySession={replaySession}
      onExit={() => {
        setMatch(null);
        setReplaySession(null);
      }}
    />
  );
}

interface MatchSceneProps {
  readonly match: MatchData;
  readonly replaySession: ReplaySession | null;
  readonly onExit: () => void;
}

function MatchScene(props: MatchSceneProps): React.JSX.Element {
  const { match, replaySession, onExit } = props;
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Recording HUD signals — driven by refs (inside RAF) and surfaced to React via state.
  const [recHud, setRecHud] = useState<{ recording: boolean; durSec: number; clipBufSec: number }>({
    recording: false,
    durSec: 0,
    clipBufSec: 0,
  });
  const [replayHud, setReplayHud] = useState<{ active: boolean; finalTick: number; driftStatus: "pending" | "match" | "drift" | null }>({
    active: replaySession !== null,
    finalTick: replaySession?.file.finalTickCount ?? 0,
    driftStatus: replaySession !== null ? "pending" : null,
  });
  const [toast, setToast] = useState<string | null>(null);

  // Auto-clear toast after 4s — same UX as the editor's save toasts.
  useEffect(() => {
    if (toast === null) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);
  // Seed the HUD's load-warning chip from the just-completed load so
  // the first paint already shows any drops. (RAF tick refreshes the
  // tally fields, but warnings are static post-load.)
  const initialWarningLines = match.diagnostics
    .all()
    .slice(0, 5)
    .map((w) => `[${w.source}] ${w.message}`);
  const [hud, setHud] = useState<HudReadout>({
    tick: 0,
    fps: 0,
    simStepsThisFrame: 0,
    unitTypesRegistered: 0,
    prefabsCached: match.prefabBank.size(),
    weaponPartMeshes: 0,
    schematicsLoaded: match.schematics.length,
    prefabsRequested: match.prefabsRequested,
    entities: 0,
    selected: 0,
    navMeshStatus: "building",
    team0Alive: 0,
    team1Alive: 0,
    team0Dead: 0,
    team1Dead: 0,
    activeProjectiles: 0,
    terrainImpacts: 0,
    matchWinner: null,
    loadWarningCount: match.diagnostics.count(),
    loadWarningLines: initialWarningLines,
  });
  // Click-to-expand state for the load-warnings chip. Default
  // collapsed so the chip is just "Load warnings: N"; clicking
  // expands to show the first 5 lines.
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const [damageNumbers, setDamageNumbers] = useState<
    { id: number; value: number; x: number; y: number; z: number; bornMs: number }[]
  >([]);
  /**
   * Hotkey-gated floating damage-number overlay. v1 anchors the numbers
   * to the top-left corner (no camera projection yet), which reads as a
   * debug column rather than as combat feedback — Phee flagged it as a
   * visual distraction. Defaulted OFF; press `~` (Backquote) to toggle.
   * When a v2 projects the numbers to world-space-over-target, this gate
   * can be removed and the overlay defaulted back ON.
   */
  const [damageOverlayVisible, setDamageOverlayVisible] = useState(false);
  /**
   * Persistent HP bars above every living unit. Default ON — the owner
   * couldn't tell visually whether tanks were damaging each other; bars
   * give the standard RTS feedback loop. Toggle with `H` (mirrors the
   * `~` toggle pattern for damage numbers).
   */
  const [hpBarsVisible, setHpBarsVisible] = useState(true);

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
    // In replay mode we honour the recording's seed exactly — that's the
    // determinism contract. Otherwise we use the local default.
    const effectiveSeed = replaySession?.file.simSeed ?? SEED;
    const sim = new SimRunner({ hz: HZ, seed: effectiveSeed });

    // --- Audio bus + listener attached to camera ------------------------
    const audioListener = new THREE.AudioListener();
    camera.add(audioListener);
    const audioBus = new AudioBus(audioListener);
    // The very first user gesture is required to start the AudioContext
    // on most browsers. We attach a one-shot resume call.
    const onFirstGesture = (): void => {
      void audioBus.resume();
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("keydown", onFirstGesture, { once: true });

    // --- Clip recorder (rolling 60s) ------------------------------------
    const clipRecorder = new ClipRecorder(renderer.domElement);
    clipRecorder.start();

    // --- Replay recorder (lockstep command log) -------------------------
    // We always construct it; F11 toggles whether it's actively recording.
    // Team spawn descriptors are LIVE-MODE only; in replay mode we record
    // nothing (the source replay already exists on disk).
    const replayRecorder = new ReplayRecorder({
      runner: sim,
      seed: effectiveSeed,
      mapProjectName: match.map.manifest.name,
      schematicAssetKeys: match.schematics.map((s) => s.unit.id),
      teams: [
        {
          teamId: TEAM_0,
          spawnYawRad: Math.PI / 2,
          spawnCenterXZ: [
            terrain.widthM / 2 - TEAM_SPACING_M / 2,
            terrain.depthM / 2,
          ],
          unitTypeIdxs: match.schematics.map((_, i) => i),
        },
        {
          teamId: TEAM_1,
          spawnYawRad: -Math.PI / 2,
          spawnCenterXZ: [
            terrain.widthM / 2 + TEAM_SPACING_M / 2,
            terrain.depthM / 2,
          ],
          unitTypeIdxs: match.schematics.map((_, i) => i),
        },
      ],
    });

    // --- Replay playback: pre-load the command bus ----------------------
    let driftChecked = false;
    if (replaySession) {
      sim.commands.loadFromLog(replaySession.file.commands);
    }

    // --- Initial spawn ---------------------------------------------------
    // Heightmap samplers — extracted to a shared util so spawn-path
    // (clamped to map edge) and projectile-path (null-on-OOB for the
    // loud-over-silent OOB warn) share the same bilinear math. Drift
    // between the two would produce visible Z-fighting at the unit/ground
    // contact line and silent damage-through-hill bugs respectively.
    const heightAt = makeClampedHeightSampler(match.map);
    const projectileHeightAt = makeProjectileHeightSampler(match.map);

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
      match.diagnostics,
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
      match.diagnostics,
    );
    // Phase 2 Stage 1 — spawn placed buildings AFTER team units so each
    // building's eid is allocated last. Buildings are static; their
    // placement coordinates come from MatchData.placedBuildings (authored
    // in PlaceBuildingsStep). Empty list = legacy behavior (no buildings).
    const buildingCount = spawnPlacedBuildings(
      sim.world,
      match.typeRegistry,
      match.prefabBank,
      unitRenderer,
      match.placedBuildings,
      heightAt,
      match.schematics,
      match.projectileRegistry,
      match.diagnostics,
    );
    const spawnedCount = team0Count + team1Count + buildingCount;
    // Running total of terrain impacts since match start. Bumped each
    // time the events drain surfaces a projectile_impact_terrain or
    // beam_blocked_by_terrain event. Surfaced to HUD via setHud below.
    let terrainImpactCount = 0;
    console.info(
      `[GameRuntime] spawned ${spawnedCount} entities (team 0: ${team0Count}, team 1: ${team1Count}, buildings: ${buildingCount}) across ${match.typeRegistry.size()} unit type(s).`,
    );
    // Spawn pass may have added more warnings (per-type "no prefab"
    // lines + the all-skipped summary). Refresh the HUD chip so the
    // very first paint reflects the full picture, not just the
    // pre-spawn snapshot.
    if (match.diagnostics.count() > 0) {
      setHud((h) => ({
        ...h,
        loadWarningCount: match.diagnostics.count(),
        loadWarningLines: match.diagnostics
          .all()
          .slice(0, 5)
          .map((w) => `[${w.source}] ${w.message}`),
      }));
    }

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
      // Hardpoint offsets are authored in NATIVE sim meters (chassis-scale),
      // but units RENDER at UNIT_RENDER_SCALE. We must scale the offset so
      // the muzzle WORLD position aligns with the visible barrel mesh. If we
      // don't, projectiles spawn 1-2m forward of empty space "in front of"
      // the tiny tank instead of from its barrel.
      //
      // Sim trade-off: the projectile now departs from a point ~1-2m closer
      // to the unit center than the sim "thinks" the hardpoint is. With
      // weapon ranges of 50m+ and target distances of 60m+, this delta is
      // <3% of flight distance — negligible. Hit detection, range gates,
      // and damage use unscaled sim positions; only this RENDER spawn
      // location and rotation pass through the scale.
      tmpVec.set(lx, ly, lz)
        .multiplyScalar(UNIT_RENDER_SCALE)
        .applyQuaternion(tmpQuat);
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
      // Phase 1 Week 5 — terrain occlusion. Projectiles + beams now
      // sample the heightmap and abort before reaching their target if
      // a hill is in the way. Re-uses the same bilinear sampler as
      // unit-spawn grounding (single source of truth) so the
      // projectile's "I hit dirt" line aligns with where a unit would
      // be standing on that dirt.
      terrainHeightAt: projectileHeightAt,
    });

    // --- Combat VFX --------------------------------------------------
    const projRenderer = new ProjectileRenderer();
    scene.add(projRenderer.group);
    const vfx = new CombatVfxManager();
    scene.add(vfx.group);
    // HP bars float above every living unit. visible-on-mount mirrors the
    // initial React state (`hpBarsVisible` defaults to true). The H hotkey
    // below flips both the renderer and the HUD label.
    const hpBars = new HpBarRenderer();
    scene.add(hpBars.group);

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

        // Replay mode: pathfinder still mounts (needed by movement
        // arrival path) but selection + command controllers DO NOT —
        // the lockstep log is the only input source during playback.
        if (replaySession !== null) {
          setHud((h) => ({ ...h, navMeshStatus: "ready" }));
          return;
        }

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

    // --- Hotkeys: F10 = save clip, F11 = toggle replay record ----------
    const onKeyDown = (e: KeyboardEvent): void => {
      // F10 — save last 60s clip.
      if (e.key === "F10") {
        e.preventDefault();
        clipRecorder
          .saveLast60s()
          .then((path) => {
            if (path) setToast(`Clip saved: ${path}`);
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[GameRuntime] clip save failed", err);
            setToast(`Clip save failed: ${msg}`);
          });
        return;
      }
      // ` / ~ — toggle the floating damage-number overlay (defaulted off
      // because the v1 layout reads as a debug column in the top-left
      // corner). Useful when verifying that combat resolved a hit;
      // ignore it for the normal cinematic view.
      if (e.key === "`" || e.key === "~" || e.code === "Backquote") {
        e.preventDefault();
        setDamageOverlayVisible((v) => !v);
        return;
      }
      // H — toggle persistent HP bars above every living unit. Default ON
      // (per the brief: always-visible feedback is friendlier for combat
      // verification). The HUD label below mirrors the renderer state.
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        setHpBarsVisible((v) => {
          const next = !v;
          hpBars.setVisible(next);
          return next;
        });
        return;
      }
      // F11 — toggle replay recording. Disabled in replay mode (would be
      // recording the replay-of-the-replay, which is just the source file).
      if (e.key === "F11") {
        e.preventDefault();
        if (replaySession !== null) {
          setToast("Recording disabled in replay mode");
          return;
        }
        if (replayRecorder.isRecording()) {
          replayRecorder
            .stopAndSave()
            .then((path) => {
              if (path) setToast(`Replay saved: ${path}`);
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.error("[GameRuntime] replay save failed", err);
              setToast(`Replay save failed: ${msg}`);
            });
        } else {
          replayRecorder.start();
          setToast("Recording started");
        }
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);

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

      // Audio cue dispatch (Phase 1 Week 4 placeholder synth).
      // Distance attenuation is handled inside AudioBus; here we only
      // map sim event → cue id and supply the world position.
      for (let i = 0; i < drained.length; i++) {
        const ev: SimEvent = drained[i];
        switch (ev.kind) {
          case "weapon_fired":
            audioBus.play(
              AudioCue.WeaponFireShort,
              new THREE.Vector3(ev.x, ev.y, ev.z),
            );
            break;
          case "impact":
            audioBus.play(
              AudioCue.ImpactKinetic,
              new THREE.Vector3(ev.x, ev.y, ev.z),
            );
            break;
          case "death":
            audioBus.play(AudioCue.UnitDeath);
            break;
          case "projectile_impact_terrain":
          case "beam_blocked_by_terrain":
            // Phase 1 Week 5 — terrain occlusion. Bump the HUD's
            // proof-the-system-works counter; the scorch decal itself
            // is spawned by CombatVfxManager.ingest above.
            terrainImpactCount++;
            audioBus.play(
              AudioCue.ImpactKinetic,
              new THREE.Vector3(ev.x, ev.y, ev.z),
            );
            break;
          // projectile_spawned / projectile_despawned: render-only, no audio.
          default:
            break;
        }
      }

      // Replay drift verification — fired once when playback reaches
      // (or passes) the recorded final tick count.
      if (
        replaySession &&
        !driftChecked &&
        sim.clock.tickId >= replaySession.file.finalTickCount
      ) {
        driftChecked = true;
        verifyReplayDrift(sim.world, replaySession.file.finalStateHash)
          .then(({ matched, actualHash }) => {
            if (matched) {
              setReplayHud((h) => ({ ...h, driftStatus: "match" }));
              setToast("Replay verified — no drift");
            } else {
              setReplayHud((h) => ({ ...h, driftStatus: "drift" }));
              setToast(
                `Replay DRIFT — expected ${replaySession.file.finalStateHash.slice(0, 12)}…, got ${actualHash.slice(0, 12)}…`,
              );
            }
          })
          .catch((err: unknown) => {
            console.error("[GameRuntime] drift check failed", err);
          });
      }


      // ECS → InstancedMesh sync + InstanceIndex rebuild for selection.
      runUnitRenderSystem(sim.world, unitRenderer, instanceIndex);
      projRenderer.update(sim.world);
      // Per-frame HP bar sync — reads Position + Health, writes sprite
      // pose/scale/colour. Cheap (≤ ~100 units in Phase 1 budget).
      hpBars.updateFromWorld(sim.world);
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
          weaponPartMeshes: unitRenderer.subMeshCount(),
          schematicsLoaded: match.schematics.length,
          prefabsRequested: match.prefabsRequested,
          entities: spawnedCount,
          team0Alive: tally.team0Alive,
          team1Alive: tally.team1Alive,
          team0Dead: tally.team0Dead,
          team1Dead: tally.team1Dead,
          activeProjectiles: tally.activeProjectiles,
          terrainImpacts: terrainImpactCount,
          matchWinner: winner,
        }));
        // Recording HUD — duration since start + current clip buffer.
        const recActive = replayRecorder.isRecording();
        const startedIso = replayRecorder.getStartedAtIso();
        const durSec =
          recActive && startedIso
            ? (Date.now() - new Date(startedIso).getTime()) / 1000
            : 0;
        setRecHud({
          recording: recActive,
          durSec,
          clipBufSec: clipRecorder.bufferedSec(),
        });
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
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onFirstGesture);
      ro.disconnect();
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      command?.dispose();
      selection?.dispose();
      pathFollower?.dispose();
      navHandle?.dispose();
      rtsCamera.dispose();
      projRenderer.dispose();
      vfx.dispose();
      hpBars.dispose();
      unitRenderer.dispose();
      terrain.dispose();
      physics.dispose();
      // NOTE: match.prefabBank is owned by the parent GameRuntime
      // component (it lives on `match` state), NOT this effect.
      // Disposing here breaks the React 19 StrictMode dev-double-effect
      // cycle: cleanup wipes the cache → second mount finds it empty →
      // MatchSpawner logs "no prefab cached" → 0 entities spawn.
      // Disposal happens in GameRuntime's useEffect keyed on `match`.
      // Recording teardown order: stop active recording (no save), then
      // dispose audio so the AudioContext doesn't outlive its listener.
      replayRecorder.cancel();
      clipRecorder.dispose();
      audioBus.dispose();
      camera.remove(audioListener);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={mountRef} className="game-runtime-root" style={ROOT_STYLE}>
      {/* REC indicator — top-left, only when actively recording. */}
      {recHud.recording && (
        <div style={REC_INDICATOR_STYLE} aria-label="Replay recording indicator">
          <span style={REC_DOT_STYLE}>●</span> REC {recHud.durSec.toFixed(1)}s
        </div>
      )}
      {/* Replay-mode banner — top-center when playing back. */}
      {replayHud.active && (
        <div style={REPLAY_BANNER_STYLE} aria-label="Replay playback banner">
          REPLAY {Math.min(hud.tick, replayHud.finalTick)}/{replayHud.finalTick}
          {replayHud.driftStatus === "match" && " (verified)"}
          {replayHud.driftStatus === "drift" && " (DRIFT)"}
        </div>
      )}
      {/* Hotkey hints — bottom-left corner. */}
      <div style={HOTKEY_HINTS_STYLE} aria-hidden>
        <div>[F10] Save last 60s clip ({recHud.clipBufSec}s buffered)</div>
        {replayHud.active ? null : (
          <div>
            [F11] {recHud.recording ? "Stop + save" : "Start"} replay recording
          </div>
        )}
        <div>[`] Damage numbers: {damageOverlayVisible ? "on" : "off"}</div>
        <div>[H] HP bars: {hpBarsVisible ? "on" : "off"}</div>
      </div>
      {/* Transient toast — auto-clears after a few seconds via effect below. */}
      {toast && <div style={TOAST_STYLE}>{toast}</div>}
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
        <div>Weapon parts: {Math.max(0, hud.weaponPartMeshes - hud.unitTypesRegistered)}</div>
        {/* Loud accounting triplet — schematics : prefabsRequested :
            prefabsCached. All three should match end-to-end; a divergence
            turns the row orange and points at exactly which layer dropped
            data. See HudReadout.schematicsLoaded comment for read-out. */}
        <div
          style={
            hud.schematicsLoaded === hud.prefabsRequested &&
            hud.prefabsRequested === hud.prefabsCached
              ? undefined
              : LOAD_TRIPLET_MISMATCH_STYLE
          }
          aria-label="Schematics, prefabs requested, prefabs cached"
        >
          Load chain: {hud.schematicsLoaded} : {hud.prefabsRequested} :{" "}
          {hud.prefabsCached}
        </div>
        <div>Entities: {hud.entities}</div>
        <div>Selected: {hud.selected}</div>
        <div style={{ color: "#9cccff" }}>
          Team 0 (blue): {hud.team0Alive} alive · {hud.team0Dead} dead
        </div>
        <div style={{ color: "#ff8c7c" }}>
          Team 1 (red):  {hud.team1Alive} alive · {hud.team1Dead} dead
        </div>
        <div>Projectiles: {hud.activeProjectiles}</div>
        <div>Terrain impacts: {hud.terrainImpacts}</div>
        <div>
          Navmesh: {hud.navMeshStatus}
          {hud.navMeshError ? ` (${hud.navMeshError})` : ""}
        </div>
        <div>Sim steps/frame: {hud.simStepsThisFrame}</div>
        {hud.loadWarningCount > 0 && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setWarningsExpanded((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setWarningsExpanded((v) => !v);
              }
            }}
            style={LOAD_WARN_STYLE}
            aria-label={`${hud.loadWarningCount} load warning(s); click to ${warningsExpanded ? "collapse" : "expand"}.`}
          >
            <div>
              Load warnings: {hud.loadWarningCount}{" "}
              <span style={LOAD_WARN_TOGGLE_STYLE}>
                {warningsExpanded ? "▾" : "▸"}
              </span>
            </div>
            {warningsExpanded && (
              <div style={LOAD_WARN_DETAIL_STYLE}>
                {hud.loadWarningLines.map((line, i) => (
                  <div key={i} style={LOAD_WARN_LINE_STYLE}>
                    {line}
                  </div>
                ))}
                {hud.loadWarningCount > hud.loadWarningLines.length && (
                  <div style={LOAD_WARN_MORE_STYLE}>
                    +{hud.loadWarningCount - hud.loadWarningLines.length} more
                    in console
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <button type="button" onClick={onExit} style={EXIT_BUTTON_STYLE}>
          Exit Match
        </button>
      </div>
      {hud.navMeshStatus === "building" ? (
        <div style={NAVMESH_OVERLAY_STYLE}>Building navmesh…</div>
      ) : null}
      {/* Floating damage numbers — HOTKEY-GATED off by default. The v1
          layout stacks values in the top-left corner (no camera
          projection yet) which reads as a debug column rather than as
          per-target combat feedback. Press ` (Backquote) to toggle.
          When v2 projects damage values to world-space-over-target,
          remove the gate and default this back on. */}
      {damageOverlayVisible && <DamageNumberOverlay numbers={damageNumbers} />}
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

const REC_INDICATOR_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  padding: "4px 10px",
  background: "rgba(0,0,0,0.75)",
  color: "#ff7878",
  border: "1px solid #6e2d2d",
  borderRadius: 3,
  font: "bold 12px ui-monospace, SFMono-Regular, Menlo, monospace",
  pointerEvents: "none",
  userSelect: "none",
};

const REC_DOT_STYLE: React.CSSProperties = {
  color: "#ff3030",
  marginRight: 4,
};

const REPLAY_BANNER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 10,
  left: "50%",
  transform: "translateX(-50%)",
  padding: "4px 12px",
  background: "rgba(0,0,0,0.75)",
  color: "#ffd05a",
  border: "1px solid #6e5a2d",
  borderRadius: 3,
  font: "bold 12px ui-monospace, SFMono-Regular, Menlo, monospace",
  pointerEvents: "none",
  userSelect: "none",
};

const HOTKEY_HINTS_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: 10,
  left: 10,
  padding: "4px 8px",
  background: "rgba(0,0,0,0.55)",
  color: "#9aa3b0",
  border: "1px solid #2a2a2f",
  borderRadius: 3,
  font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
  pointerEvents: "none",
  userSelect: "none",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const TOAST_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: 60,
  left: 10,
  padding: "6px 12px",
  background: "rgba(20,28,40,0.92)",
  color: "#e8eef5",
  border: "1px solid #3a4252",
  borderRadius: 3,
  font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
  pointerEvents: "none",
  userSelect: "none",
  maxWidth: 600,
  whiteSpace: "pre-wrap",
};

const LOAD_TRIPLET_MISMATCH_STYLE: React.CSSProperties = {
  color: "#ffb347",
  fontWeight: "bold",
};

const LOAD_WARN_STYLE: React.CSSProperties = {
  marginTop: 4,
  padding: "4px 6px",
  background: "rgba(60, 30, 8, 0.65)",
  border: "1px solid #a85a1c",
  borderRadius: 3,
  color: "#ffc97a",
  cursor: "pointer",
  userSelect: "none",
  pointerEvents: "auto",
};

const LOAD_WARN_TOGGLE_STYLE: React.CSSProperties = {
  display: "inline-block",
  width: 12,
  textAlign: "center",
  color: "#ffd9a6",
};

const LOAD_WARN_DETAIL_STYLE: React.CSSProperties = {
  marginTop: 4,
  paddingTop: 4,
  borderTop: "1px dashed #6b3e15",
  display: "flex",
  flexDirection: "column",
  gap: 2,
  maxWidth: 440,
};

const LOAD_WARN_LINE_STYLE: React.CSSProperties = {
  color: "#ffd9a6",
  font: "10.5px ui-monospace, SFMono-Regular, Menlo, monospace",
  wordBreak: "break-word",
};

const LOAD_WARN_MORE_STYLE: React.CSSProperties = {
  color: "#bb8a55",
  font: "italic 10px ui-monospace, SFMono-Regular, Menlo, monospace",
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
