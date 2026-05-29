/**
 * box-projection.ts — pure Three.js helpers for wrapping a single image
 * onto an arbitrary mesh as a "skin" via box projection.
 *
 * Box projection (a.k.a. triplanar with hard dominant-axis selection)
 * samples the texture using the fragment's WORLD position, choosing one
 * of three planar projections (XY / XZ / ZY) based on which component of
 * the world normal dominates. This avoids relying on the mesh's own UV
 * layout (templates and many imported meshes have none, or unusable ones)
 * while keeping the full MeshStandardMaterial PBR lighting intact.
 *
 * The projection is normalised to the group's world-space bounding box so
 * the whole image maps once across the model regardless of its scale.
 *
 * No React here — these are framework-agnostic scene utilities.
 */

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Deep clone.
// ---------------------------------------------------------------------------

/**
 * Deep-clone a group so the copy owns independent geometry + materials.
 * Required when displaying the same source mesh in a second scene — a
 * shallow clone(true) shares GPU resources and breaks on dispose.
 */
export function deepCloneGroup(group: THREE.Group): THREE.Group {
  const clone = group.clone(true);
  clone.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry = node.geometry.clone();
      node.material = Array.isArray(node.material)
        ? node.material.map((m) => m.clone())
        : node.material.clone();
      // THREE's clone() serialises userData via JSON — a saved
      // __origMaterial (a Material reference) becomes a non-Material JSON
      // blob. Restoring/disposing that blob later throws. The clone manages
      // its own skin lifecycle, so drop the stale bookkeeping entirely.
      const ud = node.userData as { __origMaterial?: unknown };
      if ("__origMaterial" in ud) delete ud.__origMaterial;
    }
  });
  return clone;
}

// ---------------------------------------------------------------------------
// Material factory.
// ---------------------------------------------------------------------------

/** Per-material data we stash on userData so callers can identify + tweak. */
interface SkinUserData {
  /** Marks a material as a box-projection skin (vs. an original material). */
  isSkin: true;
  /** Live uniform objects, exposed for completeness (not required). */
  skinUniforms: {
    uBoxMin: { value: THREE.Vector3 };
    uBoxSize: { value: THREE.Vector3 };
    uSkin: { value: THREE.Texture };
  };
}

/**
 * Build a MeshStandardMaterial that samples `texture` via box projection
 * (dominant world-normal axis) instead of mesh UVs, normalised to the
 * given world-space bounding box. Keeps full PBR lighting via
 * onBeforeCompile injection.
 */
export function makeBoxProjectedMaterial(
  texture: THREE.Texture,
  boxMin: THREE.Vector3,
  boxSize: THREE.Vector3,
  base?: { color?: number; roughness?: number; metalness?: number },
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: base?.color ?? 0xffffff,
    roughness: base?.roughness ?? 0.7,
    metalness: base?.metalness ?? 0.1,
  });

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  // Guard the box size against zero (degenerate / flat meshes) so the
  // normalisation never divides by 0.
  const safeSize = new THREE.Vector3(
    Math.max(boxSize.x, 1e-4),
    Math.max(boxSize.y, 1e-4),
    Math.max(boxSize.z, 1e-4),
  );

  const uBoxMin = { value: boxMin.clone() };
  const uBoxSize = { value: safeSize };
  const uSkin = { value: texture };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBoxMin = uBoxMin;
    shader.uniforms.uBoxSize = uBoxSize;
    shader.uniforms.uSkin = uSkin;

    // --- Vertex shader: expose world position + world normal -------------
    // `worldpos_vertex` is only conditionally included by three, so we
    // instead derive the world position right after `project_vertex`
    // (always present) using the still-object-space `transformed`.
    // `beginnormal_vertex` (always present) gives us `objectNormal`.
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;",
      )
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\n\tvWorldNormal = mat3(modelMatrix) * objectNormal;",
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n\tvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );

    // --- Fragment shader: box-projection sampling ------------------------
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          "varying vec3 vWorldPos;",
          "varying vec3 vWorldNormal;",
          "uniform vec3 uBoxMin;",
          "uniform vec3 uBoxSize;",
          "uniform sampler2D uSkin;",
        ].join("\n"),
      )
      .replace(
        "#include <map_fragment>",
        [
          "vec3 bn = abs(normalize(vWorldNormal));",
          "vec3 uvw = (vWorldPos - uBoxMin) / uBoxSize;",
          "vec2 boxUV;",
          "if (bn.x >= bn.y && bn.x >= bn.z)      { boxUV = uvw.zy; }",
          "else if (bn.y >= bn.x && bn.y >= bn.z) { boxUV = uvw.xz; }",
          "else                                    { boxUV = uvw.xy; }",
          "vec4 skinTexel = texture2D(uSkin, boxUV);",
          "diffuseColor.rgb *= skinTexel.rgb;",
        ].join("\n"),
      );
  };

  const userData: SkinUserData = {
    isSkin: true,
    skinUniforms: { uBoxMin, uBoxSize, uSkin },
  };
  mat.userData = userData;

  return mat;
}

// ---------------------------------------------------------------------------
// Apply / remove on a whole group.
// ---------------------------------------------------------------------------

/** Handle returned by applySkin so the caller can dispose GPU resources. */
export interface AppliedSkin {
  texture: THREE.Texture;
  materials: THREE.Material[];
}

/** True if `mat` is one of our box-projection skin materials. */
function isSkinMaterial(mat: THREE.Material): boolean {
  const ud = mat.userData as Partial<SkinUserData>;
  return ud.isSkin === true;
}

/** Read a sensible base tint from an existing material (preserves color). */
function readBaseColor(material: THREE.Material | THREE.Material[]): number {
  const first = Array.isArray(material) ? material[0] : material;
  if (first instanceof THREE.MeshStandardMaterial) {
    return first.color.getHex();
  }
  return 0xffffff;
}

/**
 * Apply a box-projected skin to every Mesh in `group`. Stores the previous
 * material on each mesh's userData.__origMaterial so removeSkin can restore
 * it. Computes the group's world bbox internally.
 *
 * Returns the created texture + materials so the caller can dispose them.
 */
export function applySkin(
  group: THREE.Group,
  image: HTMLImageElement,
): AppliedSkin {
  // World-space bounding box of the whole (already transformed) group.
  const bbox = new THREE.Box3().setFromObject(group);
  const boxMin = bbox.min.clone();
  const boxSize = new THREE.Vector3();
  bbox.getSize(boxSize);

  // One shared texture for the whole group.
  const texture = new THREE.Texture(image);
  texture.needsUpdate = true;

  const materials: THREE.Material[] = [];

  group.traverse((node: THREE.Object3D) => {
    if (!(node instanceof THREE.Mesh)) return;
    const mesh = node;

    const current = mesh.material;
    const currentIsSkin = Array.isArray(current)
      ? current.every(isSkinMaterial)
      : isSkinMaterial(current);

    // Base tint survives whether `current` is an original material or a
    // prior skin (both are MeshStandardMaterial carrying the colour).
    const baseColor = readBaseColor(current);

    if (currentIsSkin) {
      // This mesh is ALREADY wearing a skin — typically a clone of an
      // already-skinned master. That stale skin's projection box was
      // computed for the master's world position (e.g. the origin), so it
      // would sample the wrong region once this group sits elsewhere (the
      // battlefield slot at map-centre). Dispose the stale skin and build a
      // fresh one for THIS group's world box. Do NOT overwrite any real
      // original already saved in __origMaterial.
      const stale = Array.isArray(current) ? current : [current];
      for (const m of stale) m.dispose();
    } else {
      // First skin on a pristine mesh — preserve the true original so
      // removeSkin can restore it.
      mesh.userData.__origMaterial = current;
    }

    const skinMat = makeBoxProjectedMaterial(texture, boxMin, boxSize, {
      color: baseColor,
    });
    mesh.material = skinMat;
    materials.push(skinMat);
  });

  return { texture, materials };
}

/**
 * Restore original materials saved by applySkin and dispose the skin
 * texture + skin materials. Safe to call if no skin was applied.
 */
export function removeSkin(
  group: THREE.Group,
  applied: AppliedSkin | null,
): void {
  // Restore every mesh that has a saved original material — defensive even
  // when `applied` is null (e.g. a stale skin lingering on the group).
  const isDisposableMaterial = (m: unknown): m is THREE.Material =>
    !!m && typeof (m as THREE.Material).dispose === "function";

  group.traverse((node: THREE.Object3D) => {
    if (!(node instanceof THREE.Mesh)) return;
    const mesh = node;
    const ud = mesh.userData as { __origMaterial?: unknown };
    if (ud.__origMaterial !== undefined) {
      const orig = ud.__origMaterial;
      // Only restore a genuine Material. A hot-reload can serialise the saved
      // reference into a plain JSON blob; restoring that would crash the next
      // dispose. Drop the blob silently and leave the current material.
      if (Array.isArray(orig) ? orig.every(isDisposableMaterial) : isDisposableMaterial(orig)) {
        mesh.material = orig as THREE.Material | THREE.Material[];
      }
      delete ud.__origMaterial;
    }
  });

  if (applied === null) return;

  applied.texture.dispose();
  for (const mat of applied.materials) {
    mat.dispose();
  }
}
