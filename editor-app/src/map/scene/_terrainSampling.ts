/**
 * Terrain sampling helpers — shared by PlaceObjectController and
 * ScatterController so both behave identically on slopes.
 *
 * Both functions ray-cast from y=100 straight down onto a terrain mesh.
 * 100m is comfortably above the highest sculpt-able heights (default
 * brush strength caps at 2 m/tick × stroke length) and avoids the
 * pathological case of starting INSIDE the mesh.
 *
 * Why face normal × world-matrix instead of geometry normals direct:
 *   Three's BufferGeometry stores normals in OBJECT space. To get the
 *   world-space normal we multiply by the inverse-transpose of the
 *   object's world matrix. THREE.Matrix3.getNormalMatrix() does exactly
 *   that. The terrain mesh's transform is currently identity, so this
 *   is "free" — but writing it correctly future-proofs against the day
 *   we let the user rotate or scale the entire map.
 */

import * as THREE from "three";

/** Reusable ray + scratch vectors so we don't allocate on every sample. */
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3(0, -1, 0);
const _ray = new THREE.Raycaster();
const _normalMatrix = new THREE.Matrix3();

/** Sample terrain normal at a world XZ position. Returns null if out of bounds. */
export function sampleTerrainNormal(
  terrainMesh: THREE.Mesh,
  worldX: number,
  worldZ: number,
): THREE.Vector3 | null {
  _origin.set(worldX, 100, worldZ);
  _ray.set(_origin, _dir);
  const hits = _ray.intersectObject(terrainMesh, false);
  if (hits.length === 0 || !hits[0].face) return null;
  _normalMatrix.getNormalMatrix(hits[0].object.matrixWorld);
  return hits[0].face.normal.clone().applyMatrix3(_normalMatrix).normalize();
}

/**
 * Compute Euler rotation that aligns the local +Y axis to the given world
 * normal, clamped so the prefab never tilts more than `maxTiltRad` from
 * vertical. Returns an `{x,y,z}` tuple (radians, XYZ Euler order).
 *
 * Why clamp:
 *   On near-vertical cliff faces the natural alignment would lay a
 *   prefab on its side — a car or building flipped sideways looks
 *   broken. Clamping to ~60° gives a "leans with the slope" look that's
 *   plausible up to surprisingly steep terrain. Above that, props
 *   stand upright and pop visually rather than disappear.
 *
 * Math:
 *   We compute the angle between world-up and the surface normal, clamp
 *   it, then build the clamped target normal by spherically interpolating
 *   from up TOWARD normal by the ratio (clampedAngle / fullAngle). A
 *   quaternion rotation from up→clampedNormal then yields the Euler.
 */
export function alignToNormal(
  normal: THREE.Vector3,
  maxTiltRad: number = Math.PI / 3,
): { x: number; y: number; z: number } {
  const up = new THREE.Vector3(0, 1, 0);
  const fullAngle = up.angleTo(normal);
  if (fullAngle < 0.001) return { x: 0, y: 0, z: 0 };
  const angle = Math.min(fullAngle, maxTiltRad);
  // Lerp toward `normal` by the clamp ratio, then re-normalize. The
  // result is a unit vector tilted `angle` rad from up, in the same
  // azimuthal direction as `normal`. Slerp would be more correct but lerp
  // is fine here because the angles are small (≤60° by clamp).
  const clampedNormal = up.clone().lerp(normal, angle / fullAngle).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(up, clampedNormal);
  const euler = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return { x: euler.x, y: euler.y, z: euler.z };
}

/** Sample terrain Y at a world XZ position. Returns null if out of bounds. */
export function sampleTerrainY(
  terrainMesh: THREE.Mesh,
  worldX: number,
  worldZ: number,
): number | null {
  _origin.set(worldX, 100, worldZ);
  _ray.set(_origin, _dir);
  const hits = _ray.intersectObject(terrainMesh, false);
  return hits[0]?.point.y ?? null;
}
