/**
 * Auto-Voxelize: given a Three.js Object3D (Mesh or Group), fills its
 * interior with a MutableVoxelMap using a ray-casting inside/outside test.
 *
 * Algorithm overview
 * ------------------
 * 1. Extract every triangle from the geometry, transformed to world space.
 * 2. Normalize the triangle set so the mesh's bounding box is centered on
 *    the voxel grid and scaled to fill GRID_SIZE-2 cells (1-cell margin).
 * 3. For each of the GRID_SIZE^3 voxel cells:
 *      - Compute the cell center in normalized mesh space.
 *      - Cast 3 axis-aligned rays (+X, +Y, +Z).
 *      - Count triangle intersections per ray using Möller–Trumbore.
 *      - Apply majority vote: if ≥2 of the 3 rays see an odd intersection
 *        count, the cell is INSIDE the mesh → add 'hull' voxel.
 *
 * Performance
 * -----------
 * GRID_SIZE=16 → 4 096 cells × 3 rays = ~12 288 ray bundles.  For typical
 * meshes with a few hundred to a few thousand triangles this completes in
 * well under a second on any modern CPU — no worker threads needed for v0.2.
 *
 * References
 * ----------
 * Möller, T. & Trumbore, B. (1997). "Fast, Minimum Storage Ray/Triangle
 * Intersection". Journal of Graphics Tools, 2(1), 21–28.
 */

import * as THREE from "three";
import type { MaterialId, MutableVoxelMap, VoxelGrid, VoxelMap } from "../types/voxel";
import { GRID_SIZE } from "./constants";
import { serialize } from "./voxel-grid";

// ---------------------------------------------------------------------------
// Internal triangle representation.
// ---------------------------------------------------------------------------

/** Three world-space vertices forming one triangle. */
type Triangle = readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3];

// ---------------------------------------------------------------------------
// Möller–Trumbore ray–triangle intersection.
// ---------------------------------------------------------------------------

const EPSILON = 1e-8;

/**
 * Möller–Trumbore ray–triangle intersection test.
 *
 * Returns true if the ray starting at `origin` in direction `dir` (a unit or
 * non-unit direction vector) intersects the triangle (v0, v1, v2) at a
 * non-negative parameter t.  Degenerate triangles (area ≈ 0) return false.
 *
 * The algorithm tests the parametric intersection without computing the actual
 * hit point, which is exactly what we need for parity (inside/outside) counting.
 */
function rayIntersectsTriangle(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  v0: THREE.Vector3,
  v1: THREE.Vector3,
  v2: THREE.Vector3,
): boolean {
  // edge1 = v1 - v0, edge2 = v2 - v0
  const edge1x = v1.x - v0.x;
  const edge1y = v1.y - v0.y;
  const edge1z = v1.z - v0.z;

  const edge2x = v2.x - v0.x;
  const edge2y = v2.y - v0.y;
  const edge2z = v2.z - v0.z;

  // h = dir × edge2
  const hx = dir.y * edge2z - dir.z * edge2y;
  const hy = dir.z * edge2x - dir.x * edge2z;
  const hz = dir.x * edge2y - dir.y * edge2x;

  // a = edge1 · h
  const a = edge1x * hx + edge1y * hy + edge1z * hz;

  // Degenerate triangle or ray parallel to triangle plane.
  if (a > -EPSILON && a < EPSILON) return false;

  const f = 1.0 / a;

  // s = origin - v0
  const sx = origin.x - v0.x;
  const sy = origin.y - v0.y;
  const sz = origin.z - v0.z;

  // u = f * (s · h)
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0.0 || u > 1.0) return false;

  // q = s × edge1
  const qx = sy * edge1z - sz * edge1y;
  const qy = sz * edge1x - sx * edge1z;
  const qz = sx * edge1y - sy * edge1x;

  // v = f * (dir · q)
  const v = f * (dir.x * qx + dir.y * qy + dir.z * qz);
  if (v < 0.0 || u + v > 1.0) return false;

  // t = f * (edge2 · q)  — intersection is at origin + t*dir
  const t = f * (edge2x * qx + edge2y * qy + edge2z * qz);

  // Only forward intersections (t ≥ 0).
  return t >= 0.0;
}

// ---------------------------------------------------------------------------
// Directions for the three axis-aligned rays.
// ---------------------------------------------------------------------------

const DIR_POS_X = new THREE.Vector3(1, 0, 0);
const DIR_POS_Y = new THREE.Vector3(0, 1, 0);
const DIR_POS_Z = new THREE.Vector3(0, 0, 1);

/**
 * Count how many triangles the ray (origin, dir) intersects.
 * Returns parity: true = odd count = inside.
 */
function isInsideAlongAxis(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  triangles: readonly Triangle[],
): boolean {
  let count = 0;
  for (const [v0, v1, v2] of triangles) {
    if (rayIntersectsTriangle(origin, dir, v0, v1, v2)) {
      count++;
    }
  }
  return (count & 1) === 1; // odd count → inside
}

// ---------------------------------------------------------------------------
// Triangle extraction from a Three.js Object3D.
// ---------------------------------------------------------------------------

/**
 * Walk `object` and collect every triangle as world-space Vector3 triples.
 * Applies each mesh's `matrixWorld` so the triangles all live in a common
 * coordinate space.
 */
function extractTriangles(object: THREE.Object3D): Triangle[] {
  const triangles: Triangle[] = [];

  // Ensure world matrices are up to date before we read them.
  object.updateWorldMatrix(true, true);

  object.traverse((node: THREE.Object3D) => {
    if (!(node instanceof THREE.Mesh)) return;

    const geometry: THREE.BufferGeometry = node.geometry as THREE.BufferGeometry;
    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    const matrixWorld: THREE.Matrix4 = node.matrixWorld;

    const getVertex = (i: number): THREE.Vector3 => {
      const v = new THREE.Vector3(
        posAttr.getX(i),
        posAttr.getY(i),
        posAttr.getZ(i),
      );
      return v.applyMatrix4(matrixWorld);
    };

    const indexAttr = geometry.index;

    if (indexAttr !== null) {
      // Indexed geometry.
      for (let i = 0; i < indexAttr.count; i += 3) {
        const a = indexAttr.getX(i);
        const b = indexAttr.getX(i + 1);
        const c = indexAttr.getX(i + 2);
        triangles.push([getVertex(a), getVertex(b), getVertex(c)]);
      }
    } else {
      // Non-indexed geometry — every 3 positions form a triangle.
      for (let i = 0; i < posAttr.count; i += 3) {
        triangles.push([getVertex(i), getVertex(i + 1), getVertex(i + 2)]);
      }
    }
  });

  return triangles;
}

// ---------------------------------------------------------------------------
// Mesh normalization — map world-space bounding box to grid space.
// ---------------------------------------------------------------------------

interface NormalizationParams {
  /** World-space center of the mesh bounding box. */
  readonly meshCenter: THREE.Vector3;
  /** Uniform scale: multiply a world-space offset to get grid-space offset. */
  readonly scale: number;
  /** Grid-space center the mesh maps to. */
  readonly gridCenter: THREE.Vector3;
}

/**
 * Compute scale + offset so the mesh's largest dimension fits in
 * GRID_SIZE-2 cells (leaving a 1-cell margin on each side), centered
 * at (GRID_SIZE/2, GRID_SIZE/2, GRID_SIZE/2).
 *
 * Returns null if the bounding box is degenerate (zero-size mesh).
 */
function computeNormalization(object: THREE.Object3D): NormalizationParams | null {
  const box = new THREE.Box3();
  box.setFromObject(object);

  if (box.isEmpty()) return null;

  const size = new THREE.Vector3();
  box.getSize(size);

  const largestDim = Math.max(size.x, size.y, size.z);
  if (largestDim < EPSILON) return null;

  const targetSize = GRID_SIZE - 2; // leave 1-cell margin
  const scale = targetSize / largestDim;

  const center = new THREE.Vector3();
  box.getCenter(center);

  const half = GRID_SIZE / 2;

  return {
    meshCenter: center,
    scale,
    gridCenter: new THREE.Vector3(half, half, half),
  };
}

/**
 * Convert a world-space point to normalized grid space using the params
 * computed by `computeNormalization`.
 */
function worldToGrid(
  worldPt: THREE.Vector3,
  params: NormalizationParams,
): THREE.Vector3 {
  return new THREE.Vector3(
    (worldPt.x - params.meshCenter.x) * params.scale + params.gridCenter.x,
    (worldPt.y - params.meshCenter.y) * params.scale + params.gridCenter.y,
    (worldPt.z - params.meshCenter.z) * params.scale + params.gridCenter.z,
  );
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Voxelize a Three.js Group or Mesh into a MutableVoxelMap.
 * Fills the interior with the 'hull' material.
 * Returns an empty map if the geometry has no triangles.
 */
export function voxelizeMesh(mesh: THREE.Object3D): MutableVoxelMap {
  const result: MutableVoxelMap = new Map<string, MaterialId>();

  // Step 1: extract world-space triangles.
  const worldTriangles = extractTriangles(mesh);
  if (worldTriangles.length === 0) return result;

  // Step 2: compute normalization so the mesh fits the grid.
  const norm = computeNormalization(mesh);
  if (norm === null) return result;

  // Step 3: transform all triangle vertices into grid space once (not per cell).
  const gridTriangles: Triangle[] = worldTriangles.map(([v0, v1, v2]) => [
    worldToGrid(v0, norm),
    worldToGrid(v1, norm),
    worldToGrid(v2, norm),
  ]);

  // Step 4: iterate every cell in the GRID_SIZE^3 grid.
  const origin = new THREE.Vector3();

  for (let cx = 0; cx < GRID_SIZE; cx++) {
    for (let cy = 0; cy < GRID_SIZE; cy++) {
      for (let cz = 0; cz < GRID_SIZE; cz++) {
        // Cell center in grid space: (cx + 0.5, cy + 0.5, cz + 0.5).
        origin.set(cx + 0.5, cy + 0.5, cz + 0.5);

        // Cast 3 rays (+X, +Y, +Z) and count odd-intersection responses.
        let insideVotes = 0;
        if (isInsideAlongAxis(origin, DIR_POS_X, gridTriangles)) insideVotes++;
        if (isInsideAlongAxis(origin, DIR_POS_Y, gridTriangles)) insideVotes++;
        if (isInsideAlongAxis(origin, DIR_POS_Z, gridTriangles)) insideVotes++;

        // Majority vote: ≥2 of 3 rays say inside.
        if (insideVotes >= 2) {
          result.set(`${cx},${cy},${cz}`, "hull");
        }
      }
    }
  }

  return result;
}

/**
 * Convert a VoxelMap to a VoxelGrid (sparse_grid_v1) ready for the unit
 * schema.  Delegates to the existing `serialize` utility in voxel-grid.ts
 * so there is no duplicated derivation logic (bounding box, mass, hardpoints,
 * material map).
 */
export function voxelMapToGrid(voxels: VoxelMap): VoxelGrid {
  return serialize(voxels);
}
