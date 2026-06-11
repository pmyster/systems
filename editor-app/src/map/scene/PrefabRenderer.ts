/**
 * PrefabRenderer — reconciles the store's `objects` map against a
 * Three.js subtree. One Object3D per placed instance, keyed by the
 * instance id.
 *
 * Reconciliation model (mirrors React's approach to the DOM):
 *   - `sync(objects)` is idempotent — call it whenever `objects` changes.
 *   - New ids: build via prefab registry, parent under `root`, tag with
 *     `userData.instanceId` so raycasting can recover the id.
 *   - Existing ids: re-apply transform to the same Object3D reference.
 *   - Missing ids: detach, dispose geometry/materials, drop the map entry.
 *
 * Unknown prefabId is logged at WARN level (per the loud-over-silent
 * defensive pattern) rather than swallowed — if a map file references a
 * prefab we don't know about, the user must see it in the console.
 *
 * Raycasting walks back up the parent chain from a hit until it finds
 * the `instanceId`-tagged ancestor, so prefab implementations are free
 * to nest meshes inside groups (e.g. our cube uses a Group wrapper to
 * survive the renderer's `position.set(...)` overwrite).
 */

import * as THREE from "three";

import type { InstanceObject } from "../state/mapStore";
import { prefabRegistry } from "./prefabs";

export class PrefabRenderer {
  readonly root: THREE.Group;
  private byId = new Map<string, THREE.Object3D>();

  constructor() {
    this.root = new THREE.Group();
    this.root.name = "PrefabRoot";
  }

  /** Apply the current store snapshot of `objects` to the scene. Idempotent. */
  sync(objects: Record<string, InstanceObject>): void {
    const seenIds = new Set<string>();
    for (const id of Object.keys(objects)) {
      seenIds.add(id);
      const inst = objects[id];
      let node = this.byId.get(id);
      if (!node) {
        const def = prefabRegistry.get(inst.prefabId);
        if (!def) {
          // Defensive: surface unknown prefab ids loudly so missing
          // registrations don't drop instances silently.
          console.warn(
            `[PrefabRenderer] Unknown prefabId '${inst.prefabId}' for instance ${id}. Skipping.`,
          );
          continue;
        }
        node = def.build();
        node.userData.instanceId = id;
        this.byId.set(id, node);
        this.root.add(node);
      }
      // Apply transform — commands mutate the store, we render the result.
      node.position.set(inst.position.x, inst.position.y, inst.position.z);
      node.rotation.set(inst.rotation.x, inst.rotation.y, inst.rotation.z);
      node.scale.set(inst.scale.x, inst.scale.y, inst.scale.z);
    }
    // Remove nodes whose instances have vanished from the store.
    for (const id of Array.from(this.byId.keys())) {
      if (!seenIds.has(id)) {
        const node = this.byId.get(id)!;
        this.root.remove(node);
        this.disposeSubtree(node);
        this.byId.delete(id);
      }
    }
  }

  /** Get the rendered Object3D for an instance id, or null. Used by the gizmo. */
  getNode(id: string): THREE.Object3D | null {
    return this.byId.get(id) ?? null;
  }

  /**
   * Hit-test all prefab nodes against a ray; return the topmost instance
   * id or null. Walks the parent chain so meshes nested inside Groups
   * (the standard pattern for build-time visual offsets) still resolve.
   */
  raycastInstance(raycaster: THREE.Raycaster): string | null {
    const hits = raycaster.intersectObject(this.root, true);
    if (hits.length === 0) return null;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && obj.userData.instanceId === undefined) obj = obj.parent;
    return (obj?.userData.instanceId as string | undefined) ?? null;
  }

  private disposeSubtree(node: THREE.Object3D): void {
    node.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }

  dispose(): void {
    for (const [, node] of this.byId) {
      this.disposeSubtree(node);
    }
    this.byId.clear();
    this.root.clear();
  }
}
