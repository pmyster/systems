/**
 * Pure material-painting operations over a VoxelMap.
 *
 * Every exported function returns a NEW MutableVoxelMap and never mutates
 * its input. None of these operations add or remove voxels — they only
 * repaint cells that ALREADY EXIST in the supplied map. Cells that don't
 * exist are skipped silently (the caller's geometry is the source of truth;
 * material ops never invent occupancy).
 *
 * Voxel keys are "x,y,z" integer-coordinate strings (see VoxelMap in
 * src/types/voxel.ts). Coordinate parsing is centralized in parseKey so a
 * malformed key surfaces as a skipped cell rather than a NaN that silently
 * poisons distance math.
 */

import type { MaterialId, VoxelMap, MutableVoxelMap } from "../types/voxel";

// ---------------------------------------------------------------------------
// Key helpers.
// ---------------------------------------------------------------------------

/** Parse an "x,y,z" key into an integer triple, or null if malformed. */
function parseKey(key: string): [number, number, number] | null {
  const p = key.split(",");
  if (p.length !== 3) return null;
  const x = Number(p[0]);
  const y = Number(p[1]);
  const z = Number(p[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

/** Build an "x,y,z" key from an integer triple. */
function makeKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** The six face-adjacent neighbor offsets (6-connectivity). */
const FACE_NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// ---------------------------------------------------------------------------
// Operations.
// ---------------------------------------------------------------------------

/**
 * Paint a center cell plus every existing voxel within Chebyshev
 * (chessboard / max-axis) distance `brushSize - 1` of it, setting them
 * to `material`. brushSize 1 = just the center cell; 2 = 3x3x3 block; 3 = 5x5x5.
 * Returns a new map. Cells that don't exist in `voxels` are skipped.
 */
export function paintBrush(
  voxels: VoxelMap,
  cx: number,
  cy: number,
  cz: number,
  material: MaterialId,
  brushSize: number,
): MutableVoxelMap {
  const out: MutableVoxelMap = new Map(voxels);
  // brushSize 1 => radius 0 (center only). A non-positive size paints nothing.
  const radius = brushSize - 1;
  if (radius < 0) return out;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const key = makeKey(cx + dx, cy + dy, cz + dz);
        if (out.has(key)) out.set(key, material);
      }
    }
  }
  return out;
}

/**
 * Flood-fill: starting from (cx,cy,cz), repaint every 6-connected
 * (face-adjacent) voxel that currently shares the start cell's material,
 * setting them to `material`. BFS over the existing-voxel graph. Returns
 * a new map. If the start cell doesn't exist, returns an unchanged copy.
 */
export function floodFill(
  voxels: VoxelMap,
  cx: number,
  cy: number,
  cz: number,
  material: MaterialId,
): MutableVoxelMap {
  const out: MutableVoxelMap = new Map(voxels);
  const startKey = makeKey(cx, cy, cz);
  const startMat = voxels.get(startKey);
  if (startMat === undefined) return out;

  const visited = new Set<string>([startKey]);
  const queue: Array<[number, number, number]> = [[cx, cy, cz]];

  while (queue.length > 0) {
    const cell = queue.shift();
    if (cell === undefined) break;
    const [x, y, z] = cell;
    out.set(makeKey(x, y, z), material);

    for (const [ox, oy, oz] of FACE_NEIGHBORS) {
      const nx = x + ox;
      const ny = y + oy;
      const nz = z + oz;
      const nKey = makeKey(nx, ny, nz);
      if (visited.has(nKey)) continue;
      // Compare against the ORIGINAL material on `voxels`, not `out` —
      // `out` is being repainted as we go, which would otherwise let the
      // fill leak across boundaries via already-repainted cells.
      if (voxels.get(nKey) === startMat) {
        visited.add(nKey);
        queue.push([nx, ny, nz]);
      }
    }
  }
  return out;
}

/**
 * Shell/core split. A voxel is "shell" if at least one of its 6
 * face-neighbor cells is empty (not in the map) — i.e. it's on the
 * exposed surface. Fully-enclosed voxels are "core". Shell cells →
 * shellMat, core cells → coreMat. Returns a new map.
 */
export function assignShellCore(
  voxels: VoxelMap,
  shellMat: MaterialId,
  coreMat: MaterialId,
): MutableVoxelMap {
  const out: MutableVoxelMap = new Map(voxels);

  for (const key of voxels.keys()) {
    const coord = parseKey(key);
    if (coord === null) continue;
    const [x, y, z] = coord;

    let exposed = false;
    for (const [ox, oy, oz] of FACE_NEIGHBORS) {
      if (!voxels.has(makeKey(x + ox, y + oy, z + oz))) {
        exposed = true;
        break;
      }
    }
    out.set(key, exposed ? shellMat : coreMat);
  }
  return out;
}

/**
 * Height bands. Find the min and max Y among occupied voxels. Split that
 * inclusive range into `bands.length` equal bands (ordered low Y → high Y).
 * Assign every voxel the material of the band its Y falls into. Returns a
 * new map. Empty `bands` or empty `voxels` → unchanged copy.
 * Edge: when maxY === minY, all voxels go to bands[0].
 */
export function assignHeightBands(
  voxels: VoxelMap,
  bands: readonly MaterialId[],
): MutableVoxelMap {
  const out: MutableVoxelMap = new Map(voxels);
  if (bands.length === 0 || voxels.size === 0) return out;

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const key of voxels.keys()) {
    const coord = parseKey(key);
    if (coord === null) continue;
    const y = coord[1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // No parseable voxels — nothing to band.
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return out;

  for (const key of voxels.keys()) {
    const coord = parseKey(key);
    if (coord === null) continue;
    const y = coord[1];
    const frac = maxY === minY ? 0 : (y - minY) / (maxY - minY);
    let idx = Math.floor(frac * bands.length);
    if (idx >= bands.length) idx = bands.length - 1; // y === maxY edge
    if (idx < 0) idx = 0;
    const mat = bands[idx];
    if (mat !== undefined) out.set(key, mat);
  }
  return out;
}

/**
 * Swap: repaint every voxel currently set to `from` so it becomes `to`.
 * Returns a new map. No-op (still returns a fresh copy) if `from` absent.
 */
export function swapMaterial(
  voxels: VoxelMap,
  from: MaterialId,
  to: MaterialId,
): MutableVoxelMap {
  const out: MutableVoxelMap = new Map(voxels);
  for (const [key, mat] of out) {
    if (mat === from) out.set(key, to);
  }
  return out;
}
