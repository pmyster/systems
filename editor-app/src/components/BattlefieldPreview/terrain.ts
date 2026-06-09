/**
 * Procedural terrain mesh for the Battlefield Preview pane.
 *
 * Lifted from tools/battlefield-viewer/index.html lines 254-300 with
 * minimal change:
 *   - The deterministic noise stack (hash2 / smoothNoise / fbm) is
 *     inlined here so the lift remains self-contained until a shared
 *     `src/lib/noise.ts` lands. Both the mesh build and the runtime
 *     height query use the same formula, so the unit's foot is
 *     guaranteed to sit on the rendered surface.
 *   - The geometry is rotated so +Y is up and the mesh sits in the
 *     X/Z plane, then translated so the map's lower-left corner sits
 *     at world origin and the centre at (MAP_SIZE/2, 0, MAP_SIZE/2).
 *
 * Per DESIGN.md Pillar 1 (Terrain matters), the preview hints at how a
 * unit will look on real heightmap terrain — units crest ridges,
 * shadows fall consistently with the directional sun, and the vertex
 * colouring picks up the post-apocalyptic palette. The terrain mesh is
 * built once per mount; it is *not* rebuilt when the unit prop changes.
 *
 * The function returns the mesh plus a height-query closure so unit
 * placement code can ask "what's the surface Y at world (x, z)?"
 * without redoing the noise inside the renderer.
 *
 * No new dependencies; uses only the bundled `three`.
 */

import * as THREE from "three";

import { MAP_SIZE_M } from "../../lib";

// ---------------------------------------------------------------------------
// Height query.
// ---------------------------------------------------------------------------
//
// NOTE: SUNNY-GRASS MODE has retired the deterministic noise stack
// (hash2 / smoothNoise / fbm) that previously drove FBM-based hills.
// If the "moody hills" toggle is restored, lift the stack back from
// tools/battlefield-viewer/index.html lines 190-216.

/**
 * The single formula shared between the mesh build (vertex Y) and the
 * runtime query. Keeps unit feet on the surface — change one, change
 * both.
 */
function noiseHeight(_localX: number, _localZ: number): number {
  // SUNNY-GRASS MODE: flat terrain so projectile arcs and unit silhouettes
  // read clearly against a uniform ground plane. The "moody hills" mode
  // can return later as a toggle if cinematic preview is wanted.
  return 0;
}

/** World-space height at (wx, wz). Inverse of the mesh's centring. */
export function getTerrainHeight(wx: number, wz: number): number {
  const x = wx - MAP_SIZE_M / 2;
  const z = wz - MAP_SIZE_M / 2;
  return noiseHeight(x, z);
}

// ---------------------------------------------------------------------------
// Mesh construction.
// ---------------------------------------------------------------------------

/** Number of segments per side of the terrain mesh (prototype 3 line 254). */
const TERRAIN_SEGMENTS = 96;

/**
 * The terrain returned to the caller. The mesh is centred on
 * (MAP_SIZE_M/2, 0, MAP_SIZE_M/2); the height function maps world
 * coordinates to surface Y.
 */
export interface TerrainHandle {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.PlaneGeometry;
  readonly material: THREE.MeshStandardMaterial;
  readonly getHeight: (wx: number, wz: number) => number;
}

/** Build the procedural terrain mesh. Call once per scene mount. */
export function buildTerrain(): TerrainHandle {
  const geometry = new THREE.PlaneGeometry(
    MAP_SIZE_M,
    MAP_SIZE_M,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);

  const colorAttr = new Float32Array(geometry.attributes.position.count * 3);
  const tempColor = new THREE.Color();
  const positions = geometry.attributes.position;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const h = noiseHeight(x, z);
    positions.setY(i, h);

    // SUNNY-GRASS MODE: uniform mid-saturated grass green with
    // per-vertex flicker so it doesn't read as a flat-shaded billboard.
    tempColor.setHex(0x4a8a3c);
    const flicker = (Math.random() - 0.5) * 0.06;
    tempColor.r = Math.max(0, Math.min(1, tempColor.r + flicker * 0.6));
    tempColor.g = Math.max(0, Math.min(1, tempColor.g + flicker));
    tempColor.b = Math.max(0, Math.min(1, tempColor.b + flicker * 0.4));

    colorAttr[i * 3 + 0] = tempColor.r;
    colorAttr[i * 3 + 1] = tempColor.g;
    colorAttr[i * 3 + 2] = tempColor.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(MAP_SIZE_M / 2, 0, MAP_SIZE_M / 2);
  mesh.receiveShadow = true;
  mesh.name = "BattlefieldTerrain";

  return { mesh, geometry, material, getHeight: getTerrainHeight };
}

/** Dispose all GPU resources owned by the terrain. */
export function disposeTerrain(handle: TerrainHandle): void {
  handle.geometry.dispose();
  handle.material.dispose();
}
