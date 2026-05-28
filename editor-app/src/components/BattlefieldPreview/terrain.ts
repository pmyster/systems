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

import { MAP_SIZE_M, TERRAIN_AMP } from "../../lib";

// ---------------------------------------------------------------------------
// Deterministic noise stack (prototype 3 lines 190-216).
// ---------------------------------------------------------------------------

function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number): number {
  let v = 0;
  let amp = 1;
  let freq = 1;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    v += smoothNoise(x * freq, y * freq) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v / total;
}

// ---------------------------------------------------------------------------
// Height query.
// ---------------------------------------------------------------------------

/**
 * The single formula shared between the mesh build (vertex Y) and the
 * runtime query. Keeps unit feet on the surface — change one, change
 * both.
 */
function noiseHeight(localX: number, localZ: number): number {
  const nx = (localX / MAP_SIZE_M) * 4;
  const nz = (localZ / MAP_SIZE_M) * 4;
  let h = fbm(nx, nz) * TERRAIN_AMP;
  h += smoothNoise(localX * 0.02, localZ * 0.02) * 1.5;
  return h;
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

    // Banding by height — post-apocalyptic burnt-earth palette.
    if (h < -1) tempColor.setHex(0x1a1814);
    else if (h < 0.5) tempColor.setHex(0x3a3225);
    else if (h < 2) tempColor.setHex(0x5a4a35);
    else tempColor.setHex(0x6e5a3e);

    // Per-vertex flicker for grain.
    const flicker = (Math.random() - 0.5) * 0.08;
    tempColor.r = Math.max(0, Math.min(1, tempColor.r + flicker));
    tempColor.g = Math.max(0, Math.min(1, tempColor.g + flicker));
    tempColor.b = Math.max(0, Math.min(1, tempColor.b + flicker));

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
