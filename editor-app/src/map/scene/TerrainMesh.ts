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
 *   correctly), but the BASE COLOR comes from a blend of:
 *     1. An elevation gradient computed from world-space Y.
 *     2. A 4-material splatmap sampled at the vertex UV.
 *   The splatmap dominates at low elevation (painted ground), and the
 *   elevation gradient takes over at extremes (snow caps, deep water).
 *   onBeforeCompile lets us inject a sampler2D + helper functions into
 *   Three's built-in shader without re-implementing all the light loops.
 */

import * as THREE from "three";

import { HEIGHTMAP_M_PER_PIXEL } from "../coords/constants";

export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private positionAttr: THREE.BufferAttribute;
  /** Cached compiled-shader handle so we can swap the splatmap texture later. */
  private compiledShader: { uniforms: Record<string, { value: unknown }> } | null =
    null;

  constructor(
    private readonly widthPx: number,
    private readonly heightPx: number,
    initialHeightmap: Float32Array,
    /**
     * Optional splatmap texture. When provided, the shader blends 4
     * hardcoded material colors weighted by the texture's RGBA channels,
     * mixed 80/20 with the elevation gradient.
     */
    splatmap?: THREE.Texture,
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
      // Base color is overridden by the gradient+splatmap shader injected
      // below; setting white here ensures the injected color comes
      // through unmodulated by the base `diffuse` uniform.
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false,
      side: THREE.FrontSide,
      wireframe: false,
    });

    const splatTex = splatmap ?? null;
    const hasSplat = splatTex !== null;

    // Elevation-gradient + splatmap injection.
    this.material.onBeforeCompile = (shader) => {
      // Expose the splatmap as a uniform when provided.
      shader.uniforms.splatmap = { value: splatTex };
      this.compiledShader = shader;

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
varying float vWorldY;
varying vec2 vSplatUv;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vWorldY = (modelMatrix * vec4(position, 1.0)).y;
vSplatUv = uv;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying float vWorldY;
varying vec2 vSplatUv;
${hasSplat ? "uniform sampler2D splatmap;" : ""}
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
}
${
  hasSplat
    ? `vec3 splatColor(vec2 uv) {
  vec4 w = texture2D(splatmap, uv);
  float total = max(w.r + w.g + w.b + w.a, 0.001);
  // R=grass, G=dirt, B=sand, A=scorched.
  vec3 mat0 = vec3(0.32, 0.45, 0.20);
  vec3 mat1 = vec3(0.40, 0.30, 0.20);
  vec3 mat2 = vec3(0.78, 0.68, 0.45);
  vec3 mat3 = vec3(0.12, 0.10, 0.09);
  return (mat0*w.r + mat1*w.g + mat2*w.b + mat3*w.a) / total;
}`
    : ""
}`,
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          hasSplat
            ? "vec4 diffuseColor = vec4(mix(elevationColor(vWorldY), splatColor(vSplatUv), 0.8), opacity);"
            : "vec4 diffuseColor = vec4( elevationColor(vWorldY), opacity );",
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

  /**
   * Hot-swap the splatmap texture uniform. The store load path replaces
   * the splatmap byte buffer wholesale on map open, so callers need to
   * point the shader at the new DataTexture without recompiling the
   * material.
   */
  setSplatmapTexture(tex: THREE.Texture | null): void {
    if (!this.compiledShader) return;
    const u = this.compiledShader.uniforms.splatmap;
    if (u) u.value = tex;
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
