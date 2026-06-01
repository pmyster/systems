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
 * Why MeshStandardMaterial + onBeforeCompile shader injection:
 *   We want PBR lighting (so the directional sun + hemi fill read
 *   correctly), but the BASE COLOR comes from an elevation gradient
 *   computed in the fragment shader from world-space Y. onBeforeCompile
 *   lets us inject a varying + helper function into Three's built-in
 *   shader without re-implementing all the light loops. Smooth shading
 *   (flatShading=false) is required for the gradient to interpolate
 *   nicely across triangle interiors — flat faces would produce visible
 *   color banding between adjacent triangles.
 *
 *   Normal recompute strategy is unchanged: cheap during a stroke
 *   (skipped), one pass on stroke end via finalizeStroke().
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
      // Base color is overridden by the gradient shader injected below;
      // setting white here ensures the gradient color comes through
      // unmodulated by the base `diffuse` uniform.
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.0,
      // Smooth shading is required for the elevation gradient to
      // interpolate cleanly between vertices. We previously used
      // flatShading=true to defer the normal recompute during a stroke;
      // that optimisation still holds because applyDirtyPixels skips
      // computeVertexNormals — the gradient just reads stale normals
      // for the in-flight frame, which is fine for color (lighting is
      // independent).
      flatShading: false,
      side: THREE.FrontSide,
      wireframe: false,
      // fog reads through from MeshStandardMaterial without any extra
      // wiring — the injected fragment shader runs BEFORE the
      // fog-mix chunk in Three's pipeline.
    });

    // Elevation-gradient injection. Stops in world meters:
    //   y ≤ -2     deep blue water
    //   y = -0.5   shallow blue/teal
    //   y = 0      wet sand
    //   y = 0.5    dry sand
    //   y = 2      grass/dirt
    //   y = 5      rock
    //   y ≥ 10     snow
    // The shader linearly interpolates between adjacent stops so the
    // gradient is continuous (no banding) and reads like a hand-painted
    // biome map without us authoring one.
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
varying float vWorldY;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vWorldY = (modelMatrix * vec4(position, 1.0)).y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying float vWorldY;
vec3 elevationColor(float y) {
  vec3 deepWater = vec3(0.10, 0.23, 0.42);
  vec3 shallow   = vec3(0.23, 0.54, 0.69);
  vec3 wetSand   = vec3(0.54, 0.44, 0.31);
  vec3 drySand   = vec3(0.77, 0.63, 0.42);
  vec3 grass     = vec3(0.35, 0.48, 0.23);
  vec3 rock      = vec3(0.42, 0.38, 0.33);
  vec3 snow      = vec3(0.91, 0.91, 0.92);
  if (y < -2.0)  return deepWater;
  if (y < -0.5)  return mix(deepWater, shallow,  (y + 2.0)  / 1.5);
  if (y < 0.0)   return mix(shallow,   wetSand,  (y + 0.5)  / 0.5);
  if (y < 0.5)   return mix(wetSand,   drySand,  (y - 0.0)  / 0.5);
  if (y < 2.0)   return mix(drySand,   grass,    (y - 0.5)  / 1.5);
  if (y < 5.0)   return mix(grass,     rock,     (y - 2.0)  / 3.0);
  if (y < 10.0)  return mix(rock,      snow,     (y - 5.0)  / 5.0);
  return snow;
}`,
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          "vec4 diffuseColor = vec4( elevationColor(vWorldY), opacity );",
        );
    };
    this.material.needsUpdate = true;

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
