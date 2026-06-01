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
 *     2. A 4-material splatmap whose RGBA channels weight 4 tiled diffuse
 *        textures (grass / dirt / sand / scorched).
 *   The splatmap dominates at mid elevations (painted ground), and the
 *   elevation gradient takes over at extremes (snow caps, deep water) via
 *   a smoothstep on world-Y.
 *   onBeforeCompile lets us inject samplers + helper functions into
 *   Three's built-in shader without re-implementing all the light loops.
 *
 * Material textures (Slice E2):
 *   The 4 diffuse textures come from `/textures/terrain_{grass,dirt,sand,
 *   scorched}.jpg` (CC0 from AmbientCG, 1K resolution). They tile 16x
 *   across the map, giving good close-up detail without obvious repetition
 *   at the typical orbit camera distance.
 *
 *   Defensive loading: textures are loaded async on construction. If any
 *   load fails, that material slot falls back to a 1×1 DataTexture using
 *   the original hardcoded color from the legacy shader — so terrain
 *   never goes black on a missing asset (loud-over-silent: a WARN is
 *   logged for every failure).
 */

import * as THREE from "three";

import { HEIGHTMAP_M_PER_PIXEL } from "../coords/constants";
import type { ElevationProfile } from "./biomes";
import {
  DEFAULT_ELEVATION_PROFILE,
  DEFAULT_SPLAT_TO_ELEVATION_MIX,
} from "./biomes";

/**
 * Optional pre-loaded splatmap material textures. Callers can hand these
 * in directly (e.g. a test that wants deterministic colors) or omit the
 * arg and let TerrainMesh load them lazily from `/textures/terrain_*.jpg`.
 */
export interface TerrainMaterials {
  grass: THREE.Texture;
  dirt: THREE.Texture;
  sand: THREE.Texture;
  scorched: THREE.Texture;
}

/** Fallback colors — the legacy hardcoded shader values. Used when a
 *  texture file fails to load so we degrade visibly (not silently). */
const FALLBACK_COLORS = {
  grass:    [0.34, 0.55, 0.22] as const,
  dirt:     [0.40, 0.30, 0.20] as const,
  sand:     [0.78, 0.68, 0.45] as const,
  scorched: [0.12, 0.10, 0.09] as const,
};

/**
 * Build a 1×1 RGBA DataTexture filled with the given color (in 0..1).
 * Used as a fallback when a real texture file fails to load. The pixel
 * data is held by the texture (not freed), so the texture is safe to use
 * for the lifetime of the material.
 */
function makeColorTexture(rgb: readonly [number, number, number]): THREE.DataTexture {
  const data = new Uint8Array([
    Math.round(rgb[0] * 255),
    Math.round(rgb[1] * 255),
    Math.round(rgb[2] * 255),
    255,
  ]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // 1×1 fallback: no mips needed (single texel), use Linear filtering
  // so the sampler doesn't fall back to a NEAREST mip and produce hard
  // stair-stepping at oblique angles.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Load one texture file, returning a fallback DataTexture on failure. */
async function loadTextureOrFallback(
  loader: THREE.TextureLoader,
  url: string,
  fallback: readonly [number, number, number],
  slotName: string,
): Promise<THREE.Texture> {
  try {
    const tex = await loader.loadAsync(url);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    // Anisotropic filtering eliminates the horizontal banding visible at
    // grazing camera angles when tiled textures are sampled. 16 is the
    // max supported by virtually every modern GPU; the renderer clamps
    // to its actual capability internally, so over-requesting is safe.
    tex.anisotropy = 16;
    // Explicit trilinear filtering: LinearMipmapLinear interpolates
    // between mip levels so distant tiles fade smoothly instead of
    // popping. generateMipmaps=true is Three's default but we set it
    // explicitly for clarity — the loader sometimes loses this on async.
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    return tex;
  } catch (e) {
    console.warn(
      `[TerrainMesh] Failed to load terrain texture '${slotName}' from ${url} — using flat color fallback. Cause:`,
      e,
    );
    return makeColorTexture(fallback);
  }
}

/** Load all 4 terrain material textures from /textures/terrain_*.jpg. */
async function loadDefaultTerrainMaterials(): Promise<TerrainMaterials> {
  const loader = new THREE.TextureLoader();
  const [grass, dirt, sand, scorched] = await Promise.all([
    loadTextureOrFallback(loader, "/textures/terrain_grass.jpg",    FALLBACK_COLORS.grass,    "grass"),
    loadTextureOrFallback(loader, "/textures/terrain_dirt.jpg",     FALLBACK_COLORS.dirt,     "dirt"),
    loadTextureOrFallback(loader, "/textures/terrain_sand.jpg",     FALLBACK_COLORS.sand,     "sand"),
    loadTextureOrFallback(loader, "/textures/terrain_scorched.jpg", FALLBACK_COLORS.scorched, "scorched"),
  ]);
  return { grass, dirt, sand, scorched };
}

export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private positionAttr: THREE.BufferAttribute;
  /** Cached compiled-shader handle so we can swap the splatmap texture later. */
  private compiledShader: { uniforms: Record<string, { value: unknown }> } | null =
    null;
  /** Material textures actually bound to the shader (real or fallback). */
  private materials: TerrainMaterials | null = null;

  constructor(
    private readonly widthPx: number,
    private readonly heightPx: number,
    initialHeightmap: Float32Array,
    /**
     * Optional splatmap texture. When provided, the shader blends 4
     * tiled material textures weighted by the texture's RGBA channels,
     * mixed with the elevation gradient via smoothstep on world-Y.
     */
    splatmap?: THREE.Texture,
    /**
     * Optional pre-loaded material textures (grass / dirt / sand /
     * scorched). When omitted, TerrainMesh kicks off an async load from
     * `/textures/terrain_*.jpg` and binds them when ready — the terrain
     * uses fallback flat colors during the brief window before they
     * arrive (so it's never black).
     */
    materials?: TerrainMaterials,
    /**
     * Optional color-paint overlay texture. When provided, the shader
     * blends a painted RGBA tint over the material+atmosphere mix while
     * preserving the underlying luminance (bump detail still reads
     * through painted areas). Default = null = no overlay sampled.
     */
    colorPaint?: THREE.Texture,
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
    const colorPaintTex = colorPaint ?? null;
    const hasColorPaint = colorPaintTex !== null;

    // Initial material textures: either the caller's, or flat-color
    // placeholders we'll swap with real textures once they finish loading.
    // (The shader needs SOMETHING bound to the samplers at compile time —
    // a null uniform produces undefined-behaviour reads on some drivers.)
    const initialMaterials: TerrainMaterials = materials ?? {
      grass:    makeColorTexture(FALLBACK_COLORS.grass),
      dirt:     makeColorTexture(FALLBACK_COLORS.dirt),
      sand:     makeColorTexture(FALLBACK_COLORS.sand),
      scorched: makeColorTexture(FALLBACK_COLORS.scorched),
    };
    this.materials = initialMaterials;

    // Elevation-gradient + splatmap injection.
    //
    // The above-water elevation stops (mid / high / peak) are biome-driven
    // uniforms instead of hardcoded vec3 literals — `setElevationProfile`
    // writes them at runtime when MapSceneManager observes a store change.
    // Water remains FIXED (universal blue) so wet edges read the same in
    // every biome.
    this.material.onBeforeCompile = (shader) => {
      // Expose the splatmap + 4 material textures + elevation stops as uniforms.
      shader.uniforms.splatmap = { value: splatTex };
      shader.uniforms.matGrass    = { value: initialMaterials.grass };
      shader.uniforms.matDirt     = { value: initialMaterials.dirt };
      shader.uniforms.matSand     = { value: initialMaterials.sand };
      shader.uniforms.matScorched = { value: initialMaterials.scorched };
      shader.uniforms.gradMid  = {
        value: new THREE.Vector3(
          DEFAULT_ELEVATION_PROFILE.mid[0],
          DEFAULT_ELEVATION_PROFILE.mid[1],
          DEFAULT_ELEVATION_PROFILE.mid[2],
        ),
      };
      shader.uniforms.gradHigh = {
        value: new THREE.Vector3(
          DEFAULT_ELEVATION_PROFILE.high[0],
          DEFAULT_ELEVATION_PROFILE.high[1],
          DEFAULT_ELEVATION_PROFILE.high[2],
        ),
      };
      shader.uniforms.gradPeak = {
        value: new THREE.Vector3(
          DEFAULT_ELEVATION_PROFILE.peak[0],
          DEFAULT_ELEVATION_PROFILE.peak[1],
          DEFAULT_ELEVATION_PROFILE.peak[2],
        ),
      };
      shader.uniforms.splatMix = { value: DEFAULT_SPLAT_TO_ELEVATION_MIX };
      // colorVariance — drives the in-shader noise-based tint shift on
      // the elevation gradient. Default 0 = perfectly uniform (legacy
      // behaviour); the MapSceneManager subscriber pushes the per-biome
      // value once the terrain is in the scene.
      shader.uniforms.colorVariance = { value: 0.0 };
      // colorPaint — RGBA tint overlay sampled on top of the material +
      // atmosphere blend. Optional uniform; only declared in the
      // fragment shader when `hasColorPaint` is true.
      if (hasColorPaint) {
        shader.uniforms.colorPaint = { value: colorPaintTex };
      }
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
uniform sampler2D matGrass;
uniform sampler2D matDirt;
uniform sampler2D matSand;
uniform sampler2D matScorched;
uniform vec3 gradMid;
uniform vec3 gradHigh;
uniform vec3 gradPeak;
uniform float splatMix;
uniform float colorVariance;
${hasSplat ? "uniform sampler2D splatmap;" : ""}
${hasColorPaint ? "uniform sampler2D colorPaint;" : ""}

// Cheap value-noise — hash + 2D bilinear smooth. Plenty for organic patchy
// tint variation on a terrain-scale surface; we don't need fractal
// quality here, just enough variation to break monotone gradients.
float terrainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float terrainNoise(vec2 uv) {
  vec2 i = floor(uv);
  vec2 f = fract(uv);
  f = f * f * (3.0 - 2.0 * f);
  float a = terrainHash(i);
  float b = terrainHash(i + vec2(1.0, 0.0));
  float c = terrainHash(i + vec2(0.0, 1.0));
  float d = terrainHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Apply per-pixel hue/value variance to the elevation color. Uses two
// frequencies — low for big patches, higher for grain — combined into a
// signed scalar in [-1, 1] that shifts each RGB channel by a different
// amount so the result looks like organic mottling, not a luminance dial.
// Cheap exit when variance is zero so legacy maps pay nothing.
vec3 applyVariance(vec3 base, vec2 uv) {
  if (colorVariance < 0.001) return base;
  float n = terrainNoise(uv * 6.0);
  float n2 = terrainNoise(uv * 20.0) * 0.3;
  float total = (n + n2) * 2.0 - 1.0;
  vec3 shift = vec3(total * 0.15, total * 0.25, total * 0.1);
  return base * (1.0 + shift * colorVariance);
}

vec3 elevationColor(float y) {
  // Water is universally fixed across all biomes — only above-water
  // (y > 0) reads from the biome-driven gradient uniforms.
  vec3 deepWater = vec3(0.10, 0.23, 0.42);
  vec3 shallow   = vec3(0.23, 0.54, 0.69);
  vec3 wetSand   = vec3(0.54, 0.44, 0.31);
  if (y < -2.0)  return deepWater;
  if (y < -0.5)  return mix(deepWater, shallow, (y + 2.0) / 1.5);
  if (y < 0.0)   return mix(shallow,   wetSand, (y + 0.5) / 0.5);
  if (y < 0.5)   return mix(wetSand,   gradMid, y / 0.5);
  if (y < 2.0)   return gradMid;
  if (y < 5.0)   return mix(gradMid,  gradHigh, (y - 2.0) / 3.0);
  if (y < 8.0)   return mix(gradHigh, gradPeak, (y - 5.0) / 3.0);
  return gradPeak;
}
${
  hasSplat
    ? `vec3 splatColor(vec2 uv) {
  // PlaneGeometry's default V runs OPPOSITE to world Z after the
  // rotateX(-PI/2) applied in TerrainMesh's constructor: worldZ=0
  // (north) maps to vUv.y=1, worldZ=depth (south) maps to vUv.y=0.
  // PaintMaterialController writes splatmap pixels using an UNFLIPPED
  // worldZ → pxY mapping (pxY=0 ↔ worldZ=0), so the splatmap byte
  // array is semantically aligned with world. We flip V here at the
  // sample site so display matches storage. The 4 tiled material
  // textures (grass/dirt/sand/scorched) are pattern-invariant under
  // Y mirror at any tile scale, so they intentionally DO NOT get
  // flipped — only the splatmap weight lookup does.
  vec2 splatLookup = vec2(uv.x, 1.0 - uv.y);
  vec4 w = texture2D(splatmap, splatLookup);
  float total = max(w.r + w.g + w.b + w.a, 0.001);
  vec2 tileUv = uv * 8.0;
  vec3 grassRaw = texture2D(matGrass,    tileUv).rgb;
  // Vibrant pastures tint — slight green push, slight red/blue reduction.
  vec3 grass    = grassRaw * vec3(0.85, 1.18, 0.75);
  vec3 dirt     = texture2D(matDirt,     tileUv).rgb;
  vec3 sandRaw  = texture2D(matSand,     tileUv).rgb;
  // Slight golden push on sand so Desert / Mars / alien biomes that
  // tint with warm peaks read richer rather than washed-out.
  vec3 sand     = sandRaw * vec3(1.10, 1.05, 0.90);
  vec3 scorched = texture2D(matScorched, tileUv).rgb;
  // R=grass, G=dirt, B=sand, A=scorched.
  return (grass*w.r + dirt*w.g + sand*w.b + scorched*w.a) / total;
}`
    : ""
}`,
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          (hasSplat
            ? // Per-biome `splatMix` uniform controls how much the painted
              // splatmap dominates vs. the elevation gradient. Replaces the
              // previous hardcoded smoothstep curve — each biome owns its
              // own mix ratio (e.g. Mars 0.5, Bioluminescent 0.3).
              //
              // Below sea level we ALWAYS show the elevation gradient (water
              // tones) rather than the painted splatmap — wet sand on the
              // shore should read coherently in every biome.
              //
              // colorVariance is applied to the elevation tint ONLY (not the
              // splatmap), so painted material always reads as authored. The
              // variance shader is a cheap no-op when colorVariance == 0.
              `float underWater   = smoothstep(0.0, -0.5, vWorldY);
float effMix       = mix(splatMix, 0.0, underWater);
vec3 elevTinted    = applyVariance(elevationColor(vWorldY), vSplatUv);
vec4 diffuseColor  = vec4(mix(elevTinted, splatColor(vSplatUv), effMix), opacity);`
            : "vec4 diffuseColor = vec4( applyVariance(elevationColor(vWorldY), vSplatUv), opacity );") +
            (hasColorPaint
              ? `
// Color-paint overlay — sample the painted RGBA tint and blend it
// over the material+atmosphere mix while preserving the underlying
// luminance so bump / PBR detail still reads through painted areas.
// V flip matches the splatmap convention (worldZ=0 ↔ pxY=0).
{
  vec4 paint = texture2D(colorPaint, vec2(vSplatUv.x, 1.0 - vSplatUv.y));
  if (paint.a > 0.0) {
    // Pull a luminance estimate from the current diffuseColor and use
    // it to modulate the painted color — values <0.5 stay darker,
    // brighter spots stay brighter. The 1.6/0.2 affine keeps painted
    // regions readable without crushing bump detail.
    float matLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    vec3 tintedRgb = paint.rgb * (matLum * 1.6 + 0.2);
    diffuseColor.rgb = mix(diffuseColor.rgb, tintedRgb, paint.a);
  }
}`
              : ""),
        );
    };
    this.material.needsUpdate = true;

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "MapTerrainMesh";

    // If the caller didn't provide materials, kick off the async load
    // now. The fallback flat-color textures above are bound in the
    // meantime so the shader never sees an uninitialised sampler. When
    // the real textures arrive we swap them via the cached uniforms and
    // dispose the placeholders. Errors per slot are already handled by
    // `loadTextureOrFallback` (logged + fallback returned), so this
    // top-level promise effectively never rejects.
    if (!materials) {
      loadDefaultTerrainMaterials().then((loaded) => this.setMaterials(loaded));
    }
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

  /**
   * Hot-swap the color-paint overlay texture uniform. Called by the
   * scene manager whenever the store's colorPaint byte buffer gets
   * replaced wholesale (new map / project load). The shader only
   * declares the uniform when the constructor was given an initial
   * color-paint texture — calls before that compile path are no-ops.
   */
  setColorPaintTexture(tex: THREE.Texture | null): void {
    if (!this.compiledShader) return;
    const u = this.compiledShader.uniforms.colorPaint;
    if (u) u.value = tex;
  }

  /**
   * Swap the 4 PBR material textures. Disposes the previous placeholders
   * (if any) so we don't leak the 1×1 fallback DataTextures created in
   * the constructor.
   *
   * The shader uniforms hold references to the texture objects — pointing
   * them at the new textures is all the render loop needs.
   */
  setMaterials(materials: TerrainMaterials): void {
    if (this.compiledShader) {
      const u = this.compiledShader.uniforms;
      if (u.matGrass)    u.matGrass.value    = materials.grass;
      if (u.matDirt)     u.matDirt.value     = materials.dirt;
      if (u.matSand)     u.matSand.value     = materials.sand;
      if (u.matScorched) u.matScorched.value = materials.scorched;
    }
    // Dispose only the placeholders we created — never the caller's.
    const prev = this.materials;
    if (prev) {
      for (const tex of [prev.grass, prev.dirt, prev.sand, prev.scorched]) {
        if (tex instanceof THREE.DataTexture) tex.dispose();
      }
    }
    this.materials = materials;
  }

  /**
   * Push a new per-biome elevation profile + splat/elevation mix to the
   * shader uniforms. Called by MapSceneManager when it observes a change
   * in `mapStore.elevationProfile` / `splatToElevationMix` (which happens
   * on New Map → biome switch and on project load).
   *
   * Safe to call before the shader has compiled — we early-return and the
   * onBeforeCompile callback will use the DEFAULT values until the next
   * call lands. In practice the compiledShader handle is populated on the
   * first frame, so subsequent calls always take effect.
   */
  setElevationProfile(profile: ElevationProfile, splatMix: number): void {
    if (!this.compiledShader) return;
    const u = this.compiledShader.uniforms;
    const mid = u.gradMid?.value as THREE.Vector3 | undefined;
    if (mid) mid.set(profile.mid[0], profile.mid[1], profile.mid[2]);
    const high = u.gradHigh?.value as THREE.Vector3 | undefined;
    if (high) high.set(profile.high[0], profile.high[1], profile.high[2]);
    const peak = u.gradPeak?.value as THREE.Vector3 | undefined;
    if (peak) peak.set(profile.peak[0], profile.peak[1], profile.peak[2]);
    if (u.splatMix) u.splatMix.value = splatMix;
  }

  /**
   * Push the per-biome procedural color variance (0..1) into the shader.
   * Cheap and idempotent — exit early if the shader hasn't compiled yet
   * (onBeforeCompile seeds the uniform with 0.0 in that case).
   */
  setColorVariance(value: number): void {
    if (!this.compiledShader) return;
    const u = this.compiledShader.uniforms.colorVariance;
    if (u) u.value = value;
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
    // Dispose any placeholder DataTextures we still own. Real loaded
    // textures may be shared with other meshes downstream (future), so
    // we conservatively only dispose the 1×1 fallbacks we created.
    const m = this.materials;
    if (m) {
      for (const tex of [m.grass, m.dirt, m.sand, m.scorched]) {
        if (tex instanceof THREE.DataTexture) tex.dispose();
      }
    }
    this.materials = null;
  }
}
