/**
 * RuntimeTerrain — Phase 1 Week 1B
 *
 * Render-only terrain mesh built from a LoadedMap.
 *
 * Why NOT reuse MapEditor's TerrainMesh?
 *   The editor's TerrainMesh carries a heavy authoring tail: brush overlays,
 *   per-chunk splat textures, paint decals, splatmap PBR shader, dirty
 *   accumulators. The runtime needs none of that — by Week 1B it just needs
 *   "show the heightmap so the player can see where the battle is happening
 *   and the dev can verify the data pipeline survived."
 *
 *   A clean PlaneGeometry + MeshStandardMaterial keeps Week 1B small and the
 *   render-side dependencies minimal. Splatmap PBR + biome atmosphere bake
 *   are deferred to a later polish slice — the brief calls this out.
 *
 * Coordinate convention (ADR 0001):
 *   Y is up. Terrain occupies `[0, widthM] × {y} × [0, depthM]` with the
 *   manifest's `tileSizeM` (or default 1 m) as the per-pixel grid pitch.
 *   The geometry is constructed in XY (Three.js PlaneGeometry default),
 *   rotated -π/2 about X to lay it flat on XZ, then translated so its
 *   corner sits at (0, 0, 0).
 *
 * Heightmap indexing:
 *   PlaneGeometry vertex `i = row * (widthSegments + 1) + col`. Since we
 *   pass `widthSegments = widthPx - 1` and `heightSegments = heightPx - 1`,
 *   each pixel in the heightmap maps 1:1 to a vertex — same convention as
 *   the editor's TerrainMesh, so a heightmap authored in the Map editor
 *   round-trips into the runtime with no offset.
 */

import * as THREE from "three";

import type { LoadedMap } from "../loader/mapLoader";

const DEFAULT_TILE_SIZE_M = 1;

export class RuntimeTerrain {
  /** The Three.js mesh — add this to your scene graph. */
  readonly mesh: THREE.Mesh;
  /** World-space width (X axis) in meters. */
  readonly widthM: number;
  /** World-space depth (Z axis) in meters. */
  readonly depthM: number;

  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshStandardMaterial;

  constructor(map: LoadedMap) {
    const w = map.manifest.terrain.widthPx;
    const h = map.manifest.terrain.heightPx;
    const tileM = map.manifest.terrain.tileSizeM ?? DEFAULT_TILE_SIZE_M;
    this.widthM = (w - 1) * tileM;
    this.depthM = (h - 1) * tileM;

    // PlaneGeometry sits in XY by default. We construct it at (widthM ×
    // depthM) with one segment per pixel, then rotate it onto XZ and shift
    // so the (0,0) corner lands at world origin. After rotation+translation,
    // vertex (col, row) lives at world (col*tile, height, row*tile).
    this.geometry = new THREE.PlaneGeometry(this.widthM, this.depthM, w - 1, h - 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate(this.widthM / 2, 0, this.depthM / 2);

    // Apply the heightmap: row-major, same convention as the editor. The
    // post-rotation `position` attribute has X/Y/Z; Y is the height we write.
    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    const heightmap = map.heightmap;
    if (heightmap.length !== posAttr.count) {
      // Defensive: should be unreachable because mapLoader already validated
      // sizes match the manifest. Loud-over-silent if it ever drifts.
      console.warn(
        `[RuntimeTerrain] heightmap length ${heightmap.length} != vertex count ${posAttr.count}; truncating to min.`,
      );
    }
    const n = Math.min(heightmap.length, posAttr.count);
    for (let i = 0; i < n; i++) posAttr.setY(i, heightmap[i]);
    posAttr.needsUpdate = true;

    // Normals enable hemisphere + sun lighting to read terrain shape. Cheap
    // for a one-shot terrain (~129×129 = ~16k verts).
    this.geometry.computeVertexNormals();

    // Solid grass-green for now — Week 1B brief defers splatmap PBR and
    // colorpaint baking. A flat MeshStandardMaterial picks up the scene's
    // existing hemi + sun lighting (see GameRuntime) so the terrain reads
    // as a real surface, not a flat sprite.
    this.material = new THREE.MeshStandardMaterial({
      color: 0x6a8a3a,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.FrontSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "RuntimeTerrain";
    this.mesh.receiveShadow = true;
  }

  /** Free GPU resources. Call on match teardown. */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
