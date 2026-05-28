/**
 * Raycasting helpers for the Voxel Sculptor.
 *
 * Lifted from tools/voxel-editor/index.html lines 401-462
 * (getIntersect / handleClick / updateCursor). Adapted to take a
 * canvas-relative rect so React doesn't have to thread the renderer
 * domElement into every call site.
 *
 * The picker has two routines:
 *  - getIntersect: cast a ray and return the first voxel hit or the
 *    ground plane hit.
 *  - resolveCursorCell: from an intersection, decide the (x,y,z) cell
 *    a click would affect (and whether it's in-bounds).
 */

import * as THREE from "three";

import { GRID_SIZE, inBounds } from "../../lib";

// ---------------------------------------------------------------------------
// Pick result shapes.
// ---------------------------------------------------------------------------

export type Intersect =
  | { readonly type: "voxel"; readonly hit: THREE.Intersection }
  | { readonly type: "ground"; readonly hit: THREE.Intersection };

export interface CursorCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** True if the cell is within the editable GRID_SIZE^3 region. */
  readonly inside: boolean;
}

// ---------------------------------------------------------------------------
// Reusable scratchpad (avoid GC churn during pointer-move).
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// ---------------------------------------------------------------------------
// Hit testing.
// ---------------------------------------------------------------------------

/**
 * Cast a ray from the canvas-relative pointer position. Returns the
 * nearest voxel or ground intersection, or null if neither was hit.
 *
 * Lift of tools/voxel-editor/index.html lines 401-415.
 */
export function getIntersect(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  voxelMeshes: readonly THREE.Object3D[],
  ground: THREE.Object3D,
  clientX: number,
  clientY: number,
): Intersect | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  if (voxelMeshes.length > 0) {
    const voxelHits = raycaster.intersectObjects([...voxelMeshes], false);
    if (voxelHits.length > 0) {
      return { type: "voxel", hit: voxelHits[0] };
    }
  }

  const groundHits = raycaster.intersectObject(ground, false);
  if (groundHits.length > 0) {
    return { type: "ground", hit: groundHits[0] };
  }

  return null;
}

/**
 * Decide which grid cell a pointer is over, given a hit.
 *
 * On a voxel hit, returns the empty cell adjacent to the face that was
 * struck (face-normal + voxel-position floored) — this is the cell a
 * click-to-add would place into.
 *
 * On a ground hit, returns the cell at y=0 directly under the cursor.
 *
 * Lift of tools/voxel-editor/index.html lines 437-462.
 */
export function resolveCursorCell(result: Intersect): CursorCell {
  let x: number;
  let y: number;
  let z: number;
  if (result.type === "voxel") {
    const face = result.hit.face;
    const obj = result.hit.object;
    const normal = face ? face.normal : new THREE.Vector3(0, 1, 0);
    const pos = obj.position;
    x = Math.floor(pos.x + normal.x);
    y = Math.floor(pos.y + normal.y);
    z = Math.floor(pos.z + normal.z);
  } else {
    const p = result.hit.point;
    x = Math.floor(p.x);
    y = 0;
    z = Math.floor(p.z);
  }
  return { x, y, z, inside: inBounds(x, y, z, GRID_SIZE) };
}

/**
 * The cell a `remove` action would target: simply the voxel's own
 * position. Lift of tools/voxel-editor/index.html lines 430-433.
 */
export function resolveRemoveCell(result: Intersect): CursorCell | null {
  if (result.type !== "voxel") return null;
  const pos = result.hit.object.position;
  const x = Math.floor(pos.x);
  const y = Math.floor(pos.y);
  const z = Math.floor(pos.z);
  return { x, y, z, inside: inBounds(x, y, z, GRID_SIZE) };
}
};
}
