/**
 * Hand-rolled orbit camera state for the Mesh Workspace viewer.
 *
 * Mirrors VoxelSculptor/controls.ts exactly in API surface. The only
 * differences are:
 *   - camTarget is (0,1,0) — center of an 8-unit normalised mesh.
 *   - Default distance: 20
 *   - Default azimuth: Math.PI * 1.25
 *   - Default elevation: Math.PI * 0.28
 *   - ORBIT_DIST_MIN = 2, ORBIT_DIST_MAX = 80
 */

import * as THREE from "three";

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
export const ORBIT_DIST_MIN = 2;
export const ORBIT_DIST_MAX = 80;

// ---------------------------------------------------------------------------
// Construction.
// ---------------------------------------------------------------------------

/**
 * Build a fresh orbit-state pointed at the mesh centre at y=1.
 * Caller is free to mutate the returned object.
 */
export function createOrbitState(): OrbitState {
  return {
    camTarget: new THREE.Vector3(0, 1, 0),
    azimuth: Math.PI * 1.25,
    elevation: Math.PI * 0.28,
    distance: 20,
  };
}

// ---------------------------------------------------------------------------
// Mutators.
// ---------------------------------------------------------------------------

/**
 * Apply orbit state to a perspective camera (position + lookAt).
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
