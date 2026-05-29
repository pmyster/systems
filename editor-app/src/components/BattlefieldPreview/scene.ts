/**
 * Pure Three.js scene factory for the Battlefield Preview pane.
 *
 * Lifts the renderer / scene / camera setup from
 * tools/battlefield-viewer/index.html lines 218-251 plus the TA-style
 * camera rig from lines 302-318.
 *
 * Decisions:
 *   - The prototype uses PerspectiveCamera(35°). The lift map calls
 *     this out explicitly ("the narrow FOV is intentional — gives the
 *     strategic top-down look") so we keep it. The brief mentions
 *     "top-down 3D" + "TA-style"; both are satisfied by a narrow-FOV
 *     perspective camera with locked azimuth + clamped pitch, which is
 *     how Total Annihilation actually rendered its world.
 *   - The aspect ratio is initialised to 1 and updated by the
 *     BattlefieldPreview component via ResizeObserver — the prototype's
 *     `window.innerWidth` reads are intentionally NOT lifted.
 *   - Fog colour matches the scene background so the map's edges fade
 *     out instead of clipping abruptly, which keeps the camera-zoom
 *     experience feeling natural at MAP_SIZE_M = 128.
 */

import * as THREE from "three";

import {
  CAM_PITCH_DEFAULT,
  CAM_PITCH_MAX,
  CAM_PITCH_MIN,
  MAP_SIZE_M,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../../lib";

import { buildLighting, disposeLighting, type LightingHandle } from "./lighting";
import { buildTerrain, disposeTerrain, type TerrainHandle } from "./terrain";

// ---------------------------------------------------------------------------
// Camera rig.
// ---------------------------------------------------------------------------

/**
 * Default azimuth — the camera's initial yaw on load. Historically this
 * was a locked constant ("TA-style fixed-axis camera"); the camera is now
 * freely orbitable (left-drag), so this only seeds the starting angle so
 * the unit looks identical to before on first render.
 *
 * The historic position used `x = cos(AZ)*h, z = sin(AZ)*h` with
 * AZ = -π/4. The orbit formula is `x = sin(yaw)*h, z = cos(yaw)*h`, so the
 * yaw that reproduces the exact same world offset (x = +0.707h, z = -0.707h)
 * is 3π/4 — hence the seed below keeps the on-load view pixel-identical.
 */
const DEFAULT_YAW = (3 * Math.PI) / 4;

export interface CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target: THREE.Vector3;
  /** Current pitch, clamped to [CAM_PITCH_MIN, CAM_PITCH_MAX]. */
  pitch: number;
  /** Horizontal orbit angle in radians, free 0..2π. */
  yaw: number;
  /** Current zoom, clamped to [ZOOM_MIN, ZOOM_MAX]. */
  zoom: number;
  /** Recompute world-space camera position from pitch + yaw + zoom + target. */
  update(): void;
  /** Clamp pitch to the allowed band and apply. */
  setPitch(pitch: number): void;
  /** Set the horizontal orbit angle (unclamped; normalized to 0..2π) and apply. */
  setYaw(yaw: number): void;
  /** Clamp zoom to the allowed band and apply. */
  setZoom(zoom: number): void;
}

function makeCameraRig(): CameraRig {
  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 600);
  const target = new THREE.Vector3(MAP_SIZE_M / 2, 0, MAP_SIZE_M / 2);
  const rig: CameraRig = {
    camera,
    target,
    pitch: CAM_PITCH_DEFAULT,
    yaw: DEFAULT_YAW,
    zoom: ZOOM_DEFAULT,
    update() {
      const horizontal = rig.zoom * Math.cos(rig.pitch);
      const vertical = rig.zoom * Math.sin(rig.pitch);
      camera.position.set(
        target.x + horizontal * Math.sin(rig.yaw),
        target.y + vertical,
        target.z + horizontal * Math.cos(rig.yaw),
      );
      camera.lookAt(target);
    },
    setPitch(pitch: number) {
      rig.pitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, pitch));
      rig.update();
    },
    setYaw(yaw: number) {
      rig.yaw = yaw % (Math.PI * 2);
      rig.update();
    },
    setZoom(zoom: number) {
      rig.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
      rig.update();
    },
  };
  rig.update();
  return rig;
}

// ---------------------------------------------------------------------------
// Scene + renderer factory.
// ---------------------------------------------------------------------------

export interface BattlefieldScene {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: CameraRig;
  readonly terrain: TerrainHandle;
  readonly lighting: LightingHandle;
  /** Resize the renderer + camera projection. */
  resize(width: number, height: number): void;
  /** Tear down all GPU resources owned by the scene. */
  dispose(): void;
}

/**
 * Build everything that does not depend on the active unit:
 * renderer, scene, camera, terrain, lights. Returns handles the
 * BattlefieldPreview component drives from its mount effect.
 *
 * The renderer's DOM element is created here but NOT mounted; the
 * caller appends it to the container ref so React owns the lifecycle.
 */
export function buildBattlefieldScene(): BattlefieldScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d28);
  // Fog horizon should sit near the map's far edge for the default
  // zoom; both numbers come from prototype 3's tuning.
  scene.fog = new THREE.Fog(0x1a1d28, 80, 220);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Three's typings sometimes mark ACESFilmicToneMapping as readonly;
  // assign by value (it's a number constant) for forward-compat.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setSize(1, 1, false); // real size comes via ResizeObserver

  const cameraRig = makeCameraRig();
  const terrain = buildTerrain();
  scene.add(terrain.mesh);
  const lighting = buildLighting(scene);

  return {
    scene,
    renderer,
    camera: cameraRig,
    terrain,
    lighting,
    resize(width: number, height: number) {
      // Guard against zero-area containers (briefly during mount /
      // collapsed panes) — Three.js throws on a zero aspect ratio.
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      cameraRig.camera.aspect = w / h;
      cameraRig.camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    },
    dispose() {
      scene.remove(terrain.mesh);
      disposeTerrain(terrain);
      disposeLighting(scene, lighting);
      renderer.dispose();
    },
  };
}
