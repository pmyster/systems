/**
 * Hand-rolled orbit camera state.
 *
 * Lifted from tools/voxel-editor/index.html lines 234-247 (orbit state
 * + updateCameraOrbit) plus the pointer/wheel hooks at lines 472-521.
 *
 * Per docs/editor-app-tauri-lift-map.md OPEN[2026-05-27], the lift map
 * recommends keeping the hand-rolled orbit instead of pulling in
 * three/addons/OrbitControls — it's ~12 lines, has no dependency
 * footprint, and matches the prototype byte-for-byte.
 *
 * The state lives in a mutable object so that pointer-move handlers can
 * write to it without churning React state. The render-loop hook reads
 * camTarget/azimuth/elevation/distance every frame and calls
 * applyOrbit(camera, state).
 */

import * as THREE from "three";

import { GRID_SIZE } from "../../lib";

// ---------------------------------------------------------------------------
// Orbit state.
// ---------------------------------------------------------------------------

export interface OrbitState {
  /** World-space pivot point the camera orbits around. */
  readonly camTarget: THREE.Vector3;
  /** Horizontal angle, radians. */
  azimuth: number;
  /** Vertical angle, radians. Clamped to (0.05, π/2 − 0.01) by helpers. */
  elevation: number;
  /** Distance from target, world units. Clamped by ORBIT_DIST_MIN/MAX. */
  distance: number;
}

export const ORBIT_ELEVATION_MIN = 0.05;
export const ORBIT_ELEVATION_MAX = Math.PI * 0.49;
export const ORBIT_DIST_MIN = 8;
export const ORBIT_DIST_MAX = 120;

// ---------------------------------------------------------------------------
// Construction.
// ---------------------------------------------------------------------------

/**
 * Build a fresh orbit-state pointed at the grid's centerline at y=3 —
 * matches the prototype's `camTarget` (lines 235-238). Caller is free
 * to mutate the returned object.
 */
export function createOrbitState(): OrbitState {
  return {
    camTarget: new THREE.Vector3(GRID_SIZE / 2, 3, GRID_SIZE / 2),
    azimuth: Math.PI * 1.25,
    elevation: Math.PI * 0.32,
    distance: 28,
  };
}

// ---------------------------------------------------------------------------
// Mutators.
// ---------------------------------------------------------------------------

/**
 * Apply orbit state to a perspective camera (position + lookAt).
 * Lift of tools/voxel-editor/index.html lines 240-246.
 */
export function applyOrbit(
  camera: THREE.PerspectiveCamera,
  state: OrbitState,
): void {
  const { camTarget, azimuth, elevation, distance } = state;
  const x = camTarget.x + distance * Math.cos(elevation) * Math.sin(azimuth);
  const y = camTarget.y + distance * Math.sin(elevation);
  const z = camTarget.z + distance * Math.cos(elevation) * Math.cos(azimuth);
  camera.position.set(x, y, z);
  camera.lookAt(camTarget);
}

/** Clamp the elevation to the safe range (avoid gimbal lock at the poles). */
export function clampElevation(elevation: number): number {
  return Math.max(ORBIT_ELEVATION_MIN, Math.min(ORBIT_ELEVATION_MAX, elevation));
}

/** Clamp the distance to the safe zoom range. */
export function clampDistance(distance: number): number {
  return Math.max(ORBIT_DIST_MIN, Math.min(ORBIT_DIST_MAX, distance));
}

/**
 * Move the orbit pivot by (dxRight, dyForward) in the camera's local
 * ground plane. Used by middle-mouse pan.
 * Lift of tools/voxel-editor/index.html lines 493-501.
 */
export function panOrbit(
  state: OrbitState,
  dxRight: number,
  dyForward: number,
): void {
  const camRight = new THREE.Vector3(
    Math.cos(state.azimuth),
    0,
    -Math.sin(state.azimuth),
  );
  const camForward = new THREE.Vector3(
    -Math.sin(state.azimuth),
    0,
    -Math.cos(state.azimuth),
  );
  state.camTarget.addScaledVector(camRight, dxRight);
  state.camTarget.addScaledVector(camForward, dyForward);
}
