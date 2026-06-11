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

/**
 * A single sub-mesh of a registered unit type. Phase 1.5 — multi-mesh
 * chassis support: the prefab GLB for a unit (e.g. railgun_turret.glb)
 * commonly contains a hull mesh + N barrel/weapon meshes (named nodes
 * referenced by rigs). The old single-Mesh extraction left every barrel
 * invisible because they weren't `firstMesh`. The fix is to enumerate
 * every THREE.Mesh in the template subtree at `register` time, capture
 * its rest-pose local-to-prefab-root transform, and create an
 * InstancedMesh per node. Per-frame, the same unit-world matrix is
 * composed with each sub-mesh's captured local transform so the entire
 * chassis (hull + weapon parts) animates as one rigid body.
 *
 * This preserves the InstancedMesh draw-call contract: M sub-meshes × N
 * units = M draw calls, not M × N. The only growth is on the bookkeeping
 * side (one InstancedMesh per sub-mesh per type), which is bounded by
 * the GLB authoring — typically 5–15 sub-meshes for a turret-class unit.
 *
 * NOTE: rigs (e.g. yaw/pitch of barrels) are NOT animated in the runtime
 * yet — that lands when the rig animator system is ported from the
 * Battlefield Preview. For now every sub-mesh rides the chassis as a
 * rigid body, which matches the visual at rest. The chassis still aims
 * by rotating the whole unit (Rotation component); per-barrel articulation
 * is a future system.
 */
interface SubMesh {
  /** Per-sub-mesh InstancedMesh (one draw call for N units of this type). */
  readonly mesh: THREE.InstancedMesh;
  /**
   * Rest-pose local transform of this sub-mesh relative to the prefab
   * root, captured at register() time. Composed with the unit's world
   * transform each frame to place the sub-mesh in the world.
   */
  readonly localPosition: THREE.Vector3;
  readonly localQuaternion: THREE.Quaternion;
  readonly localScale: THREE.Vector3;
  /**
   * True for the chassis "primary" mesh (the one historically extracted
   * as `firstMesh`). Tints + selection-ring + dead-fade target this slot
   * only; weapon-part sub-meshes ride the chassis tint visually by sharing
   * the team-coloured base, no per-sub-mesh recoloring needed in v1.
   */
  readonly isPrimary: boolean;
  /** Originating node name in the prefab — useful for diagnostics. */
  readonly nodeName: string;
}

interface InstancedUnitType {
  readonly typeId: number;
  /**
   * All sub-meshes for this type, in registration order. `subMeshes[0]`
   * is always the primary chassis mesh (the historical `firstMesh`).
   * Selection raycasts and tinting target `subMeshes[0].mesh`; per-frame
   * sync writes every entry.
   */
  readonly subMeshes: readonly SubMesh[];
  readonly maxInstances: number;
  /** Number of slots currently occupied. Echoes `subMeshes[*].mesh.count`. */
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
   * Register a unit type. Walks the template subtree, finds EVERY THREE.Mesh,
   * captures each one's rest-pose local-to-prefab-root transform, and
   * creates one InstancedMesh per sub-mesh. The first encountered Mesh is
   * the "primary" (chassis) — selection raycasts and team tints target it;
   * subsequent meshes (typically weapon-part barrels, turrets, etc.)
   * inherit the chassis world transform composed with their captured
   * local transform.
   *
   * The template itself stays untouched — geometry is shared, materials are
   * cloned per sub-mesh so per-type tinting + dead-fade can write without
   * leaking back into the PrefabBank cache. The local transforms are read
   * via `getWorld*()` after a one-shot `updateMatrixWorld()` — since the
   * template root sits at identity in the bank, "world within the template"
   * IS "local relative to the prefab root".
   *
   * Idempotent: re-registering an already-known typeId is a no-op (no
   * accidental duplicate InstancedMesh).
   *
   * Loud-over-silent: a template with no Mesh anywhere logs + skips. A
   * sub-mesh whose material clone fails logs + skips THAT sub-mesh (other
   * sub-meshes of the same type still render).
   */
  register(
    typeId: number,
    template: THREE.Object3D,
    maxInstances: number = DEFAULT_MAX_INSTANCES_PER_TYPE,
  ): void {
    if (this.byTypeId.has(typeId)) return;

    // Refresh the template's world matrices ONCE so getWorld*() returns
    // the rest-pose local-to-root for each sub-mesh below. The template
    // is at identity in the cached bank (and never re-parented), so the
    // "world" the matrices encode is the prefab-local frame.
    template.updateMatrixWorld(true);

    // Collect every Mesh in the subtree (chassis hull + weapon-part barrels
    // + accent geometry). Order is traversal order — the first hit is the
    // primary. For a typical GLB the chassis body is exported first by
    // Blender, so the primary IS the chassis; this matches the prior
    // single-mesh behaviour for tinting + selection.
    const meshes: THREE.Mesh[] = [];
    template.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    if (meshes.length === 0) {
      // Loud-over-silent: a unit type with no mesh in its template is
      // almost certainly an authoring or load bug — surface it instead of
      // silently dropping every entity of that type.
      console.warn(
        `[InstancedUnitRenderer] register: template for typeId ${typeId} contains no Mesh; skipping (no entity of this type will render).`,
      );
      return;
    }

    const subMeshes: SubMesh[] = [];
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      const isPrimary = i === 0;
      // Clone material so per-type tint writes don't leak into the bank.
      let mat: THREE.Material;
      try {
        mat = Array.isArray(m.material)
          ? m.material[0].clone()
          : m.material.clone();
      } catch (e) {
        // Loud-over-silent: a sub-mesh whose material can't be cloned
        // (degenerate references, non-disposable proxies) is logged AND
        // skipped — other sub-meshes for this type still render.
        console.warn(
          `[InstancedUnitRenderer] register: typeId ${typeId} sub-mesh "${m.name}" — material clone failed; skipping sub-mesh.`,
          e,
        );
        continue;
      }
      // THREE.InstancedMesh raycast uses geometry.boundingSphere to
      // early-out per-instance ray-vs-sphere; without it, all hits are
      // missed silently. Compute once at register time so selection
      // raycasts hit on the primary.
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const inst = new THREE.InstancedMesh(m.geometry, mat, maxInstances);
      inst.count = 0;
      inst.frustumCulled = false; // see header comment
      // Naming convention: primary keeps the existing `UnitType_${typeId}`
      // pattern so the InstanceIndex.lookup() raycast → eid resolution
      // continues to work unchanged. Sub-meshes get a sibling prefix
      // (`UnitTypeSub_…`) which intentionally does NOT match the lookup
      // — they're visual-only, not selectable. (Selection of the chassis
      // body covers the whole unit.)
      inst.name = isPrimary
        ? `UnitType_${typeId}`
        : `UnitTypeSub_${typeId}_${i}`;
      // Per-instance colour attribute (only meaningful on primary; on
      // sub-meshes it stays at default white so they ride the chassis
      // material's natural appearance. Tinting the chassis is enough to
      // visually distinguish team without per-barrel work — and avoids
      // overtinting metal that should keep its authored colour. If a
      // future polish pass wants tinted barrels, set them here too).
      inst.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(maxInstances * 3),
        3,
      );
      for (let k = 0; k < maxInstances; k++) {
        inst.instanceColor.setXYZ(k, 1, 1, 1);
      }
      inst.instanceColor.needsUpdate = true;
      this.group.add(inst);

      // Capture rest-pose local-to-prefab-root transform. The template
      // root is at identity, so getWorld*() within it IS the local
      // transform relative to that root. Read into fresh Vector3/Quat
      // owned by this SubMesh entry (they're rest-pose constants; never
      // mutated after register).
      const localPosition = new THREE.Vector3();
      const localQuaternion = new THREE.Quaternion();
      const localScale = new THREE.Vector3();
      m.matrixWorld.decompose(localPosition, localQuaternion, localScale);

      subMeshes.push({
        mesh: inst,
        localPosition,
        localQuaternion,
        localScale,
        isPrimary,
        nodeName: m.name || `<unnamed_${i}>`,
      });
    }

    if (subMeshes.length === 0) {
      // Every sub-mesh failed material clone — extremely defensive, but
      // loud-over-silent: surface it so the HUD doesn't show 0 entities
      // with no explanation.
      console.warn(
        `[InstancedUnitRenderer] register: typeId ${typeId} — every sub-mesh failed to register; type will not render.`,
      );
      return;
    }

    this.byTypeId.set(typeId, {
      typeId,
      subMeshes,
      maxInstances,
      activeCount: 0,
    });
  }

  /**
   * Diagnostic: total sub-mesh count across all registered types.
   * Surfaced in the HUD as "Weapon parts: M" so the owner can see how
   * many distinct mesh nodes the renderer is driving — useful when a
   * GLB authoring change adds or removes nodes and the visual silently
   * differs from what was expected.
   */
  subMeshCount(): number {
    let total = 0;
    for (const t of this.byTypeId.values()) total += t.subMeshes.length;
    return total;
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

    // Scratch matrices reused across every sub-mesh & instance. Allocated
    // once per sync() call (not per instance) — same allocation profile
    // as the old single-mesh path; only the inner loop is multiplied by
    // sub-mesh count.
    const unitMat = new THREE.Matrix4();
    const subLocalMat = new THREE.Matrix4();
    const composedMat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const unitScale = new THREE.Vector3(1, 1, 1);

    // Pre-build per-sub-mesh local matrices once (rest-pose constants).
    // The inner per-instance loop only needs unitMat × subLocalMat.
    const subLocals: THREE.Matrix4[] = new Array(t.subMeshes.length);
    for (let s = 0; s < t.subMeshes.length; s++) {
      const sm = t.subMeshes[s];
      subLocals[s] = new THREE.Matrix4().compose(
        sm.localPosition,
        sm.localQuaternion,
        sm.localScale,
      );
    }

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
      unitMat.compose(v, q, unitScale);
      // Compose chassis world transform with each sub-mesh's rest-pose
      // local-to-prefab-root and write the resulting matrix into THAT
      // sub-mesh's InstancedMesh slot. All sub-meshes share slot index
      // ordering with the unit (slot i ↔ entity i ↔ same world pose),
      // which keeps the SelectionController's "primary mesh slot ==
      // entity index" invariant intact.
      for (let s = 0; s < t.subMeshes.length; s++) {
        composedMat.multiplyMatrices(unitMat, subLocals[s]);
        t.subMeshes[s].mesh.setMatrixAt(i, composedMat);
      }
      // Reuse subLocalMat to satisfy TS unused-var; the explicit pre-build
      // above is the real driver of the inner loop.
      void subLocalMat;
    }

    for (let s = 0; s < t.subMeshes.length; s++) {
      const sm = t.subMeshes[s];
      sm.mesh.count = n;
      sm.mesh.instanceMatrix.needsUpdate = true;
    }
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
    // Tint the chassis (primary) sub-mesh only — see the SubMesh.isPrimary
    // comment. Weapon-part barrels keep their authored material colour
    // for visual contrast against the team-tinted hull. If a future polish
    // pass wants tinted barrels, walk every entry of t.subMeshes here.
    const primary = t.subMeshes[0];
    if (!primary) return;
    const attr = primary.mesh.instanceColor;
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
   * Dispose every type's GPU resources owned by THIS renderer.
   *
   * IMPORTANT: geometry is BORROWED from PrefabBank's cached root — we
   * do NOT dispose it here. The bank owns the geometry lifecycle; this
   * renderer disposes only what it created (the cloned material + the
   * InstancedMesh wrapper). Disposing the borrowed geometry breaks
   * re-mount in React 19 StrictMode (the bank survives the child
   * remount; a disposed geometry on cleanup #1 would resurface on
   * mount #2 with its GPU buffer released).
   */
  dispose(): void {
    for (const t of this.byTypeId.values()) {
      // NOTE: do NOT call mesh.geometry.dispose() — geometry is owned
      // by PrefabBank.dispose(), not by us. See class header. Dispose
      // every sub-mesh's cloned material AND detach every InstancedMesh
      // from the group so the next mount starts clean.
      for (const sm of t.subMeshes) {
        const mats = Array.isArray(sm.mesh.material)
          ? sm.mesh.material
          : [sm.mesh.material];
        for (const m of mats) {
          if (m && typeof (m as THREE.Material).dispose === "function") {
            (m as THREE.Material).dispose();
          }
        }
        this.group.remove(sm.mesh);
      }
    }
    this.byTypeId.clear();
  }
}
