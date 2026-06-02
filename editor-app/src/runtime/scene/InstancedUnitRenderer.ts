/**
 * InstancedUnitRenderer — Phase 1 Week 1B
 *
 * One `THREE.InstancedMesh` per UNIT TYPE (not per entity). A match with 50
 * tanks + 30 scouts + 12 flyers draws 3 InstancedMeshes total, regardless of
 * entity count — the GPU stamps the same geometry 92 times.
 *
 * Architectural rule (from the brief, "InstancedMesh per unit type"):
 *   - Pre-allocate `maxInstances` slots per type (default 256). Spawning a
 *     new entity is O(1) — write a matrix at the next free slot.
 *   - RenderSystem (Week 1C) writes `instanceMatrix` from ECS components
 *     each frame. Until then `count = 0` and nothing draws — the bank is
 *     just sitting ready.
 *
 * Slot management:
 *   The renderer DOES NOT own slot-to-entity mapping. That lives in
 *   RenderSystem (Week 1C) which holds the ECS `eid → slot` table. Here we
 *   just expose `sync(typeId, positions, rotations, count)` — a flat-array
 *   bulk write — and the caller decides which entity is in which slot.
 *
 *   Why? The bridge between ECS and InstancedMesh writes hot every frame.
 *   Doing the mapping inside the renderer would force allocating per-frame
 *   maps or Sets; pushing the bookkeeping into the system that already owns
 *   the ECS query is both faster and clearer.
 *
 * frustumCulled = false:
 *   InstancedMesh's bounding sphere is computed once from `geometry`, not
 *   per-instance. When instances are scattered across a 128m map, the
 *   per-mesh sphere is too tight and the renderer culls visible units. Off
 *   is the conservative correct setting until we ship per-instance culling
 *   (a Week 4 polish task).
 */

import * as THREE from "three";

interface InstancedUnitType {
  readonly typeId: number;
  readonly mesh: THREE.InstancedMesh;
  readonly maxInstances: number;
  /** Number of slots currently occupied. Echoes `mesh.count`. */
  activeCount: number;
}

export const DEFAULT_MAX_INSTANCES_PER_TYPE = 256;

export class InstancedUnitRenderer {
  /** Add this group to the runtime scene; everything lives under it. */
  readonly group: THREE.Group;
  private byTypeId = new Map<number, InstancedUnitType>();

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "UnitInstances";
  }

  /**
   * Register a unit type. The renderer extracts the FIRST Mesh from the
   * template subtree (most unit GLBs and procedural templates are a single
   * mesh; multi-mesh units come in Week 1C when rigs activate). The
   * template itself stays untouched — geometry is shared, material is
   * cloned per type so per-team tinting (Week 2) can override without
   * leaking back into the bank.
   *
   * Idempotent: re-registering an already-known typeId is a no-op (no
   * accidental duplicate InstancedMesh).
   */
  register(
    typeId: number,
    template: THREE.Object3D,
    maxInstances: number = DEFAULT_MAX_INSTANCES_PER_TYPE,
  ): void {
    if (this.byTypeId.has(typeId)) return;

    let firstMesh: THREE.Mesh | null = null;
    template.traverse((o) => {
      if (firstMesh === null && o instanceof THREE.Mesh) {
        firstMesh = o;
      }
    });
    if (firstMesh === null) {
      // Loud-over-silent: a unit type with no mesh in its template is
      // almost certainly an authoring or load bug — surface it instead of
      // silently dropping every entity of that type.
      console.warn(
        `[InstancedUnitRenderer] register: template for typeId ${typeId} contains no Mesh; skipping (no entity of this type will render).`,
      );
      return;
    }
    const fm = firstMesh as THREE.Mesh;
    // Clone the material so per-type renderer settings (color tint, opacity
    // fade-on-death) don't write back into the cached bank entry.
    const mat = Array.isArray(fm.material)
      ? fm.material[0].clone()
      : fm.material.clone();
    // THREE.InstancedMesh raycast uses geometry.boundingSphere to early-out
    // per-instance ray-vs-sphere; without it, all hits are missed silently.
    // Compute once at register time so Week 2 selection raycasts hit.
    if (!fm.geometry.boundingSphere) fm.geometry.computeBoundingSphere();
    if (!fm.geometry.boundingBox) fm.geometry.computeBoundingBox();
    const inst = new THREE.InstancedMesh(fm.geometry, mat, maxInstances);
    inst.count = 0;
    inst.frustumCulled = false; // see header comment
    inst.name = `UnitType_${typeId}`;
    // Allocate per-instance color attribute up-front so Week 3 team-tint
    // writes don't crash on a null instanceColor. THREE creates it
    // lazily otherwise; doing it here makes the contract explicit.
    inst.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxInstances * 3),
      3,
    );
    // Default fill: white = no tint.
    for (let k = 0; k < maxInstances; k++) {
      inst.instanceColor.setXYZ(k, 1, 1, 1);
    }
    inst.instanceColor.needsUpdate = true;
    this.group.add(inst);
    this.byTypeId.set(typeId, {
      typeId,
      mesh: inst,
      maxInstances,
      activeCount: 0,
    });
  }

  /**
   * Bulk-write `count` instances for a registered type from flat arrays.
   *
   *   positions: Float32Array of length >= count*3, x/y/z per instance
   *   rotations: Float32Array of length >= count*4, quat x/y/z/w per instance
   *
   * Excess capacity beyond `maxInstances` is silently capped — the caller
   * should never pass more than `maxInstances` (RenderSystem owns this
   * contract via slot allocation). We log a warn so the cap surfaces.
   */
  sync(
    typeId: number,
    positions: Float32Array,
    rotations: Float32Array,
    count: number,
  ): void {
    const t = this.byTypeId.get(typeId);
    if (!t) {
      // Unknown typeId is a real bug — RenderSystem and registration must
      // agree on the id space. Loud-over-silent so the asymmetry surfaces.
      console.warn(
        `[InstancedUnitRenderer] sync: unknown typeId ${typeId}; skipping.`,
      );
      return;
    }
    if (count > t.maxInstances) {
      console.warn(
        `[InstancedUnitRenderer] sync: typeId ${typeId} count ${count} > maxInstances ${t.maxInstances}; capping.`,
      );
    }
    const n = Math.min(count, t.maxInstances);
    const mat4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) {
      v.set(
        positions[i * 3 + 0],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      );
      q.set(
        rotations[i * 4 + 0],
        rotations[i * 4 + 1],
        rotations[i * 4 + 2],
        rotations[i * 4 + 3],
      );
      mat4.compose(v, q, s);
      t.mesh.setMatrixAt(i, mat4);
    }
    t.mesh.count = n;
    t.mesh.instanceMatrix.needsUpdate = true;
    t.activeCount = n;
  }

  /**
   * Set the per-instance tint color for a slot. Caller is responsible
   * for keeping slot indices in sync with sync() ordering — typical
   * use: write a team tint right after sync() with the same slot
   * iteration order. v1 supports Week 3 team-tint of dead/alive units.
   */
  setColorAt(
    typeId: number,
    slot: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const t = this.byTypeId.get(typeId);
    if (!t) return;
    if (slot < 0 || slot >= t.maxInstances) return;
    const attr = t.mesh.instanceColor;
    if (!attr) return;
    attr.setXYZ(slot, r, g, b);
    attr.needsUpdate = true;
  }

  /** Diagnostic: how many types are registered. */
  typeCount(): number {
    return this.byTypeId.size;
  }

  /** Diagnostic: max slots reserved across all types. */
  totalCapacity(): number {
    let total = 0;
    for (const t of this.byTypeId.values()) total += t.maxInstances;
    return total;
  }

  /**
   * Dispose every type's GPU resources. Call BEFORE disposing the
   * PrefabBank so this renderer still has live references to drop.
   */
  dispose(): void {
    for (const t of this.byTypeId.values()) {
      // Geometry is shared with the PrefabBank's cached root — disposing
      // here is fine because we share-then-dispose. The bank's dispose()
      // tolerates an already-disposed BufferGeometry (Three's dispose is
      // idempotent / event-emitter-only).
      t.mesh.geometry.dispose();
      const mats = Array.isArray(t.mesh.material)
        ? t.mesh.material
        : [t.mesh.material];
      for (const m of mats) {
        if (m && typeof (m as THREE.Material).dispose === "function") {
          (m as THREE.Material).dispose();
        }
      }
      this.group.remove(t.mesh);
    }
    this.byTypeId.clear();
  }
}
