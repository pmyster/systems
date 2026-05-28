/**
 * Pure utility functions for material inference from image color data.
 * No React, no Three.js — only browser-standard types.
 */

import type { MaterialId } from "../../types/voxel";
import { MATERIALS } from "../../lib/constants";

// ---------------------------------------------------------------------------
// Hex / RGB conversion
// ---------------------------------------------------------------------------

/**
 * Parse a hex color into {r, g, b} (each 0-255).
 * Accepts numeric 0xRRGGBB or string '#rrggbb' / '0xrrggbb'.
 */
export function hexToRgb(hex: number | string): { r: number; g: number; b: number } {
  let n: number;
  if (typeof hex === "number") {
    n = hex;
  } else {
    // Strip leading '#' or '0x'/'0X'
    const cleaned = hex.replace(/^#/, "").replace(/^0x/i, "");
    n = parseInt(cleaned, 16);
  }
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
  };
}

// ---------------------------------------------------------------------------
// Nearest-material match
// ---------------------------------------------------------------------------

/**
 * Return the MaterialId whose catalog color is closest to (r, g, b)
 * in RGB Euclidean distance.
 */
export function nearestMaterial(r: number, g: number, b: number): MaterialId {
  let bestId: MaterialId = MATERIALS[0].id;
  let bestDist = Infinity;

  for (const mat of MATERIALS) {
    const { r: mr, g: mg, b: mb } = hexToRgb(mat.color);
    const dr = r - mr;
    const dg = g - mg;
    const db = b - mb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = mat.id;
    }
  }

  return bestId;
}

// ---------------------------------------------------------------------------
// Box projection
// ---------------------------------------------------------------------------

/**
 * Box-project a voxel grid coordinate onto an image face.
 *
 * Algorithm:
 *  1. Normalize (cx, cy, cz) to [0, 1] by dividing by gridSize.
 *  2. Compute distance-to-face for each of the 6 axis-aligned faces.
 *  3. Pick the face whose normalized coordinate is closest to 0 or 1.
 *  4. Return (u, v) for that face per the face-mapping spec.
 *
 * Face mapping:
 *   +X (nx closest to 1): u = 1-nz, v = 1-ny
 *   -X (nx closest to 0): u = nz,   v = 1-ny
 *   +Y (ny closest to 1): u = nx,   v = nz
 *   -Y (ny closest to 0): u = nx,   v = 1-nz
 *   +Z (nz closest to 1): u = nx,   v = 1-ny
 *   -Z (nz closest to 0): u = 1-nx, v = 1-ny
 */
export function boxProjectVoxel(
  cx: number,
  cy: number,
  cz: number,
  gridSize: number,
): { u: number; v: number } {
  const nx = cx / gridSize;
  const ny = cy / gridSize;
  const nz = cz / gridSize;

  // Distance of each normalized coordinate from its nearest boundary (0 or 1)
  const dxPos = Math.abs(nx - 1); // distance to +X face
  const dxNeg = Math.abs(nx);     // distance to -X face
  const dyPos = Math.abs(ny - 1); // distance to +Y face
  const dyNeg = Math.abs(ny);     // distance to -Y face
  const dzPos = Math.abs(nz - 1); // distance to +Z face
  const dzNeg = Math.abs(nz);     // distance to -Z face

  const minDist = Math.min(dxPos, dxNeg, dyPos, dyNeg, dzPos, dzNeg);

  if (minDist === dxPos) {
    return { u: 1 - nz, v: 1 - ny };
  } else if (minDist === dxNeg) {
    return { u: nz, v: 1 - ny };
  } else if (minDist === dyPos) {
    return { u: nx, v: nz };
  } else if (minDist === dyNeg) {
    return { u: nx, v: 1 - nz };
  } else if (minDist === dzPos) {
    return { u: nx, v: 1 - ny };
  } else {
    // dzNeg — -Z face
    return { u: 1 - nx, v: 1 - ny };
  }
}

// ---------------------------------------------------------------------------
// Image sampling
// ---------------------------------------------------------------------------

/**
 * Sample a pixel from ImageData at normalized UV coordinates [0,1].
 * Clamps u, v to [0, 1] before sampling.
 * Returns {r, g, b} 0-255.
 */
export function sampleImage(
  imageData: ImageData,
  u: number,
  v: number,
): { r: number; g: number; b: number } {
  const clampedU = Math.max(0, Math.min(1, u));
  const clampedV = Math.max(0, Math.min(1, v));

  const { width, height, data } = imageData;
  const px = Math.min(Math.floor(clampedU * width), width - 1);
  const py = Math.min(Math.floor(clampedV * height), height - 1);

  const idx = (py * width + px) * 4;
  return {
    r: data[idx],
    g: data[idx + 1],
    b: data[idx + 2],
  };
}

// ---------------------------------------------------------------------------
// Full inference pass
// ---------------------------------------------------------------------------

/**
 * Given a VoxelMap (keys = "x,y,z") and an ImageData, return a new Map
 * where each voxel's material is inferred from the image color at its
 * box-projected UV coordinate.
 *
 * Only voxel positions are taken from `voxels`; the incoming MaterialId
 * values are ignored.
 */
export function inferMaterialsFromImage(
  voxels: ReadonlyMap<string, MaterialId>,
  imageData: ImageData,
  gridSize: number,
): Map<string, MaterialId> {
  const result = new Map<string, MaterialId>();

  for (const key of voxels.keys()) {
    const parts = key.split(",");
    const cx = Number(parts[0]);
    const cy = Number(parts[1]);
    const cz = Number(parts[2]);

    const { u, v } = boxProjectVoxel(cx, cy, cz, gridSize);
    const { r, g, b } = sampleImage(imageData, u, v);
    const materialId = nearestMaterial(r, g, b);

    result.set(key, materialId);
  }

  return result;
}
