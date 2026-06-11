/**
 * DecalRenderer — reconciles the store's `decals` map against a
 * Three.js subtree of flat textured quads on the terrain surface.
 *
 * Mirrors PrefabRenderer's reconciliation contract:
 *   - `sync(decals)` is idempotent — call when `decals` changes.
 *   - New ids: build a PlaneGeometry, share the decalKind's material,
 *     parent under `root`, tag with `userData.decalId`.
 *   - Existing ids: re-apply transform + opacity to the same Mesh.
 *   - Missing ids: detach + dispose geometry (the SHARED material is NOT
 *     disposed per-instance — it lives in the registry cache).
 *
 * Why we cache materials per kind rather than per instance:
 *   A scorch decal canvas texture is identical across every scorch
 *   instance. Re-allocating the texture per placed decal would multiply
 *   GPU memory by instance count. The per-instance opacity adjustment
 *   rides on a CLONED material reference instead — same texture, distinct
 *   `transparent`/`opacity` knobs.
 *
 * Unknown decalKind is LOGGED at WARN (loud-over-silent) and the instance
 * is skipped — but the data still lives in the store so a future
 * `decalRegistry.register({...})` call followed by a re-sync would
 * resurrect them.
 */

import * as THREE from "three";

import type { DecalInstance } from "../state/mapStore";
import { decalRegistry } from "./decals";

/** Tiny vertical offset to keep decals from z-fighting with terrain. */
const DECAL_Y_LIFT = 0.05;

interface CachedNode {
  mesh: THREE.Mesh;
  /** Per-instance cloned material (shares the registry texture). */
  material: THREE.Material;
  baseSize: number;
}

export class DecalRenderer {
  readonly root: THREE.Group;
  /** Shared material per decalKind (built once on first use). */
  private materialByKind = new Map<string, THREE.Material>();
  private byId = new Map<string, CachedNode>();

  constructor() {
    this.root = new THREE.Group();
    this.root.name = "DecalRoot";
  }

  private getKindMaterial(kind: string): THREE.Material | null {
    let mat = this.materialByKind.get(kind);
    if (mat) return mat;
    const def = decalRegistry.get(kind);
    if (!def) return null;
    mat = def.build().material;
    this.materialByKind.set(kind, mat);
    return mat;
  }

  /** Apply the current store snapshot of `decals` to the scene. Idempotent. */
  sync(decals: Record<string, DecalInstance>): void {
    const seenIds = new Set<string>();
    for (const id of Object.keys(decals)) {
      seenIds.add(id);
      const inst = decals[id];
      let node = this.byId.get(id);
      if (!node) {
        const def = decalRegistry.get(inst.decalKind);
        if (!def) {
          // Defensive: data exists but the kind isn't registered. Log
          // once per encounter; the data still survives save/load.
          console.warn(
            `[DecalRenderer] Unknown decalKind '${inst.decalKind}' for instance ${id}. Skipping (data preserved in store).`,
          );
          continue;
        }
        const shared = this.getKindMaterial(inst.decalKind);
        if (!shared) continue; // already warned above
        // Clone so per-decal opacity adjustments don't leak across
        // instances. Texture handle is shared via the clone path.
        const material = shared.clone();
        const geom = new THREE.PlaneGeometry(1, 1);
        // Lay flat in the XZ plane (Y is up).
        geom.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geom, material);
        mesh.userData.decalId = id;
        mesh.name = `Decal:${inst.decalKind}`;
        node = { mesh, material, baseSize: def.baseSize };
        this.byId.set(id, node);
        this.root.add(mesh);
      }
      // Apply transform + opacity. Decals are uniform-scale planes; we
      // multiply baseSize by inst.scale on both X and Z.
      const size = node.baseSize * inst.scale;
      node.mesh.position.set(
        inst.position.x,
        inst.position.y + DECAL_Y_LIFT,
        inst.position.z,
      );
      node.mesh.rotation.set(0, inst.rotation, 0);
      node.mesh.scale.set(size, 1, size);
      // MeshBasicMaterial inherits `opacity` from the THREE.Material base.
      (node.material as THREE.MeshBasicMaterial).opacity = inst.opacity;
    }
    // Reap missing.
    for (const id of Array.from(this.byId.keys())) {
      if (!seenIds.has(id)) {
        const node = this.byId.get(id)!;
        this.root.remove(node.mesh);
        node.mesh.geometry.dispose();
        node.material.dispose();
        this.byId.delete(id);
      }
    }
  }

  dispose(): void {
    for (const [, node] of this.byId) {
      node.mesh.geometry.dispose();
      node.material.dispose();
    }
    this.byId.clear();
    for (const [, mat] of this.materialByKind) {
      const m = mat as THREE.MeshBasicMaterial;
      m.map?.dispose();
      mat.dispose();
    }
    this.materialByKind.clear();
    this.root.clear();
  }
}
