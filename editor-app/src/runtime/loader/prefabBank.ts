/**
 * prefabBank — Phase 1 Week 1B
 *
 * Dedup-loads the visual meshes referenced by the loaded unit schematics.
 *
 * Why a bank (not per-entity load)?
 *   Architectural rule from the brief: "If 50 mk01 entities share one mesh,
 *   load the GLB once and stamp 50 InstancedMesh slots, not 50 scene-graph
 *   clones." The bank is the dedup boundary — keyed on the canonical form
 *   of `unit.mesh_asset`, it loads once and serves the cached Object3D to
 *   every subsequent caller.
 *
 * Resolution mirrors the Unit editor exactly (see
 * `src/components/MeshWorkspace/MeshWorkspace.tsx` and `mesh-loader.ts`):
 *
 *   - `mesh_asset.kind === "template"` → look up `TEMPLATES` by id and call
 *     `buildGeometry()`. Built-in templates (tank, mech, flyer, …) are pure
 *     procedural Three.js — no GLB on disk.
 *
 *   - `mesh_asset.kind === "file"`     → read the file via the same
 *     `loadMeshFromPath` helper the Mesh Workspace uses, which handles GLB
 *     / GLTF / OBJ / STL with the editor's centring + normalisation rules.
 *
 * Returning a CACHED Object3D means downstream code must NEVER mutate the
 * returned subtree directly. The `InstancedUnitRenderer` extracts the
 * first Mesh's geometry + a clone of its material, so the cached root is
 * effectively read-only after registration. If a future code path needs a
 * mutable per-instance scene graph, clone first (see prefabLoader.ts for
 * the pattern).
 */

import * as THREE from "three";

import { TEMPLATES } from "../../lib/templates";
import { loadMeshFromPath } from "../../components/MeshWorkspace/mesh-loader";
import type { MeshAssetRef } from "../../types/unit";

/**
 * Canonical cache key for a mesh asset reference. Stable for identical
 * refs (template_id or path), distinct otherwise. Internal helper —
 * exposed only to the test bed.
 */
export function meshAssetKey(ref: MeshAssetRef): string {
  if (ref.kind === "template") return `template:${ref.template_id}`;
  return `file:${ref.path}`;
}

export class PrefabBank {
  /** key → loaded root (cached forever for the bank's lifetime). */
  private cache = new Map<string, THREE.Object3D>();
  /** key → in-flight promise (dedup concurrent loads of the same ref). */
  private inflight = new Map<string, Promise<THREE.Object3D>>();

  /**
   * Load (or return cached) the mesh for a unit's `mesh_asset` ref.
   *
   * Concurrent calls for the SAME ref share one promise — if two await
   * loads of "tank" overlap, only one buildGeometry() + caching happens.
   *
   * Throws if the ref points at an unknown template id or a file the
   * editor's mesh-loader rejects. Callers (MatchLoader) catch + log per
   * ref so one bad unit type doesn't kill the whole match-load.
   */
  async load(ref: MeshAssetRef): Promise<THREE.Object3D> {
    const key = meshAssetKey(ref);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = (async () => {
      let root: THREE.Object3D;
      if (ref.kind === "template") {
        const tpl = TEMPLATES.find((t) => t.id === ref.template_id);
        if (!tpl) {
          throw new Error(
            `[PrefabBank] unknown template "${ref.template_id}". ` +
              `Known: ${TEMPLATES.map((t) => t.id).join(", ")}`,
          );
        }
        // Templates return a fresh centred Group with max dim ≈ 8 units
        // (matches the NORMALIZE_TARGET_M from mesh-loader). One build per
        // bank lifetime — every downstream instance reuses the geometry.
        root = tpl.buildGeometry();
      } else {
        // `loadMeshFromPath` reads through the Rust backend, parses by
        // extension, runs the centre + normalize-scale + re-floor passes,
        // and stashes `userData.normalizeScale` + `userData.normalizedSizeM`
        // so the runtime can later honor `chassis.length_m` per Option C.
        root = await loadMeshFromPath(ref.path);
      }
      this.cache.set(key, root);
      return root;
    })();
    this.inflight.set(key, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** True iff this ref is in cache (post-await). Skips inflight checks. */
  has(ref: MeshAssetRef): boolean {
    return this.cache.has(meshAssetKey(ref));
  }

  /** Get the cached root for a ref, or undefined. Does NOT trigger a load. */
  get(ref: MeshAssetRef): THREE.Object3D | undefined {
    return this.cache.get(meshAssetKey(ref));
  }

  /** Diagnostic: how many distinct meshes are loaded. */
  size(): number {
    return this.cache.size;
  }

  /**
   * Dispose every cached subtree's GPU resources. Call when tearing down
   * a match. After this, the bank is empty and reusable for the next match.
   *
   * IMPORTANT: this also disposes geometries + materials that
   * `InstancedUnitRenderer` may have referenced (the renderer clones
   * materials but shares geometry). Callers should dispose the renderer
   * FIRST, then the bank.
   */
  dispose(): void {
    for (const obj of this.cache.values()) {
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m && typeof (m as THREE.Material).dispose === "function") {
              (m as THREE.Material).dispose();
            }
          }
        }
      });
    }
    this.cache.clear();
    this.inflight.clear();
  }
}
