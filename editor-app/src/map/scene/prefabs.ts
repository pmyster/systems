/**
 * PrefabRegistry — module-singleton catalogue of prefab definitions the
 * Place tool can spawn. Week 1 ships a single "cube" placeholder so the
 * full place → gizmo → delete → save → reload loop is wired end-to-end
 * before real assets exist.
 *
 * Design note: each prefab.build() returns a FRESH Object3D — never a
 * shared instance — because Three.js Object3D is a scene-graph node and
 * adding the same node to multiple parents corrupts its world matrix.
 * The PrefabRenderer is responsible for disposing the geometry/materials
 * it gets back when the instance is removed from the store.
 */

import * as THREE from "three";

export interface PrefabDef {
  readonly id: string;
  readonly name: string;
  /** Build the visual representation. Caller is responsible for disposing. */
  build(): THREE.Object3D;
  /** Default scale on placement (typically {1,1,1}). */
  readonly defaultScale: { x: number; y: number; z: number };
}

class PrefabRegistry {
  private prefabs = new Map<string, PrefabDef>();
  register(prefab: PrefabDef): void {
    this.prefabs.set(prefab.id, prefab);
  }
  get(id: string): PrefabDef | undefined {
    return this.prefabs.get(id);
  }
  list(): readonly PrefabDef[] {
    return Array.from(this.prefabs.values());
  }
}

export const prefabRegistry = new PrefabRegistry();

// Register the single Week-1 placeholder cube. The 8m cube sits with its
// base on the terrain surface (y=4 lifts the geometry centre by half its
// height) so a hit point on the heightmap places a cube that looks like
// it's resting on the ground rather than buried up to the equator.
//
// Sizing: 8m approximates a vehicle scale appropriate for the post-apoc
// RTS context and gives a ~90px click target at the default 100m camera
// distance — both visible at a glance and an easy raycast target.
//
// Color: bright cyan against the green/brown terrain reads instantly as
// "placeholder / debug" and contrasts hard with anything organic. A small
// emissive term keeps it readable in shadowed areas of the heightmap
// without needing a dedicated debug light.
prefabRegistry.register({
  id: "cube",
  name: "Cube (8m placeholder)",
  build: () => {
    const geo = new THREE.BoxGeometry(8, 8, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      roughness: 0.5,
      metalness: 0.1,
      emissive: 0x002233,
      emissiveIntensity: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Lift the mesh by half its height so the BASE sits on the
    // placement point, not the cube's centre. We wrap in a Group so the
    // PrefabRenderer's `position.set(...)` writes to the GROUP — the
    // child mesh keeps its local +4 offset and the visual still rests
    // on the terrain surface. Wrapping is the standard fix for the
    // "build a visual offset, then have an outer system overwrite the
    // root transform" pattern.
    mesh.position.y = 4;
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  },
  defaultScale: { x: 1, y: 1, z: 1 },
});
