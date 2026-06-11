/**
 * Lighting rig for the Battlefield Preview.
 *
 * Lifted from tools/battlefield-viewer/index.html lines 232-251:
 *   - Hemisphere light (warm sky / cool ground) for soft ambient fill.
 *   - Directional "sun" with shadow camera bounds tuned to MAP_SIZE_M.
 *   - Cool directional fill from the opposite quadrant.
 *
 * Per DESIGN.md Pillar 1 the preview must hint at how the unit will
 * look in the actual game; matching the prototype's mood keeps that
 * promise. The sun's azimuth can be rotated at runtime via `controls.ts`
 * so the operator can preview how the unit reads under different
 * lighting (long shadows at low sun, vs. flatter top-down at high sun).
 */

import * as THREE from "three";

import { MAP_SIZE_M } from "../../lib";

/** Default starting elevation of the sun above the horizon (radians). */
const SUN_ELEVATION_DEFAULT = Math.atan2(80, Math.hypot(50, 30));
/** Default starting azimuth of the sun (radians, world XZ plane). */
const SUN_AZIMUTH_DEFAULT = Math.atan2(30, 50);
/** Distance of the sun from origin, world units. Picked so shadows stay sharp. */
const SUN_DISTANCE = Math.hypot(50, 80, 30);

export interface LightingHandle {
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.DirectionalLight;
  /**
   * Set the sun's position from spherical coordinates around the map
   * centre. Azimuth in [0, 2π), elevation in (0, π/2). Useful for the
   * "rotate sun to preview lighting" affordance from prototype 3's
   * spirit (its toggles + the brief's "consistent with the
   * post-apocalyptic setting" cue).
   */
  setSunDirection(azimuth: number, elevation: number): void;
  /** Current sun azimuth (radians). */
  getSunAzimuth(): number;
  /** Current sun elevation (radians). */
  getSunElevation(): number;
}

/**
 * Build the three-light rig and attach it to `scene`. Returns handles
 * so the caller can later rotate the sun or dispose lights on unmount.
 */
export function buildLighting(scene: THREE.Scene): LightingHandle {
  const hemi = new THREE.HemisphereLight(0xc8e6ff, 0x6ba14a, 1.15);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff8e8, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 700;
  sun.shadow.camera.left = -MAP_SIZE_M * 0.78;
  sun.shadow.camera.right = MAP_SIZE_M * 0.78;
  sun.shadow.camera.top = MAP_SIZE_M * 0.78;
  sun.shadow.camera.bottom = -MAP_SIZE_M * 0.78;
  sun.shadow.bias = -0.0005;

  // Sun aims at the map centre so shadows fall consistently no matter
  // which way the operator rotates the orbiting azimuth.
  sun.target.position.set(MAP_SIZE_M / 2, 0, MAP_SIZE_M / 2);
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x9fbfe0, 0.5);
  fill.position.set(-30, 20, -40);
  scene.add(fill);

  let sunAzimuth = SUN_AZIMUTH_DEFAULT;
  let sunElevation = SUN_ELEVATION_DEFAULT;

  const handle: LightingHandle = {
    hemi,
    sun,
    fill,
    setSunDirection(azimuth: number, elevation: number) {
      sunAzimuth = azimuth;
      sunElevation = elevation;
      const horizontal = SUN_DISTANCE * Math.cos(elevation);
      const vertical = SUN_DISTANCE * Math.sin(elevation);
      sun.position.set(
        MAP_SIZE_M / 2 + Math.cos(azimuth) * horizontal,
        vertical,
        MAP_SIZE_M / 2 + Math.sin(azimuth) * horizontal,
      );
      sun.target.updateMatrixWorld();
    },
    getSunAzimuth() {
      return sunAzimuth;
    },
    getSunElevation() {
      return sunElevation;
    },
  };

  // Apply defaults so position is non-zero on first frame.
  handle.setSunDirection(sunAzimuth, sunElevation);
  return handle;
}

/** Detach lights and (where applicable) dispose shadow maps. */
export function disposeLighting(scene: THREE.Scene, handle: LightingHandle): void {
  scene.remove(handle.hemi);
  scene.remove(handle.sun);
  scene.remove(handle.sun.target);
  scene.remove(handle.fill);
  // DirectionalLight.shadow.map is created lazily by the renderer.
  // Dispose only if present so we don't crash on never-rendered scenes.
  handle.sun.shadow.map?.dispose();
}
