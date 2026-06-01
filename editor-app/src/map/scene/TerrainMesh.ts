/**
 * TerrainMesh — Three.js mesh that visualises the heightmap stored in
 * `mapStore.terrain.heightmap`.
 *
 * Layout convention:
 *   PlaneGeometry builds a flat grid on the XY plane with the +Y axis
 *   running "up" the texture. We rotateX(-PI/2) so the plane lies in the
 *   XZ plane (Y becomes world-up — see UP_AXIS in coords/constants.ts).
 *   Then we translate it so the south-west corner (world 0,0) sits at
 *   the origin instead of the geometry's centre. After those two
 *   transforms, vertex index `py * widthPx + px` corresponds to
 *   world position (px * m_per_pixel, heightmap[idx], pz * m_per_pixel).
 *
 * Update strategy:
 *   - `applyHeightmap` does a full Y-coord rewrite + normal recompute.
 *     Used on initial mount and bulk events (load, reset).
 *   - `applyDirtyPixels` only touches the indices in the dirty set and
 *     skips normal recomputation entirely — the brush stroke uploads
 *     hundreds of pixels per frame and computeVertexNormals over 16k+
 *     verts every frame is too expensive. flatShading masks the lack of
 *     normals during the stroke; we run a single recompute on stroke end
 *     via `finalizeStroke()`.
 *
 * Why MeshStandardMaterial with flatShading:
 *   Cheap, matches the post-apocalyptic muted-earth feel we want, and
 *   flatShading lets us defer the expensive normal recompute to the
 *   stroke boundary instead of every brush tick.
 */

import * as THREE from "three";

import { HEIGHTMAP_M_PER_PIXEL } from "../coords/constants";

export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private positionAttr: THREE.BufferAttribute;

  constructor(
    private readonly widthPx: number,
    private readonly heightPx: number,
    initialHeightmap: Float32Array,
  ) {
    const widthM = (widthPx - 1) * HEIGHTMAP_M_PER_PIXEL;
    const heightM = (heightPx - 1) * HEIGHTMAP_M_PER_PIXEL;

    // PlaneGeometry is XY-aligned by default; rotate to XZ so Y becomes
    // world-up. Translate so the SW corner sits at world (0, 0, 0)
    // rather than the geometry's own centre.
    this.geometry = new THREE.PlaneGeometry(
      widthM,
      heightM,
      widthPx - 1,
      heightPx - 1,
    );
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate(widthM / 2, 0, heightM / 2);

    this.positionAttr = this.geometry.attributes
      .position as THREE.BufferAttribute;
    this.applyHeightmap(initialHeightmap);

    this.material = new THREE.MeshStandardMaterial({
      color: 0x4a5a3d, // muted post-apoc earth
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true, // see header — defers normal recompute.
      side: THREE.FrontSide,
      wireframe: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "MapTerrainMesh";
  }

  /**
   * Apply a full heightmap snapshot. Used on mount and on bulk events
   * (load / reset). Recomputes vertex normals — safe because this is
   * called rarely.
   */
  applyHeightmap(heightmap: Float32Array): void {
    for (let i = 0; i < heightmap.length; i++) {
      this.positionAttr.setY(i, heightmap[i]);
    }
    this.positionAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  /**
   * Selective per-pixel apply — only updates indices in `dirtyIndices`.
   * Skips normal recompute (flatShading hides the gap). Call
   * `finalizeStroke()` on pointerup to get correct normals back.
   */
  applyDirtyPixels(
    heightmap: Float32Array,
    dirtyIndices: Iterable<number>,
  ): void {
    for (const idx of dirtyIndices) {
      this.positionAttr.setY(idx, heightmap[idx]);
    }
    this.positionAttr.needsUpdate = true;
    // Normals NOT recomputed here — see header.
  }

  /**
   * Recompute vertex normals. Call once per brush stroke on pointerup,
   * NEVER per-tick during the drag.
   */
  finalizeStroke(): void {
    this.geometry.computeVertexNormals();
  }

  setWireframe(on: boolean): void {
    this.material.wireframe = on;
  }

  /**
   * World-XZ → heightmap index (for brush hit-test results).
   * Returns -1 if the point is outside the heightmap grid.
   */
  worldToPixelIndex(worldX: number, worldZ: number): number {
    const px = Math.round(worldX / HEIGHTMAP_M_PER_PIXEL);
    const pz = Math.round(worldZ / HEIGHTMAP_M_PER_PIXEL);
    if (px < 0 || px >= this.widthPx || pz < 0 || pz >= this.heightPx)
      return -1;
    return pz * this.widthPx + px;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
