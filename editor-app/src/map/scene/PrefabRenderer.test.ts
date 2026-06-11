/**
 * Vitest coverage for PrefabRenderer.
 *
 * Coverage:
 *   - sync({}) leaves the renderer empty.
 *   - sync({a}) adds one node tagged with the instance id.
 *   - sync({a, b}) → two nodes.
 *   - Re-syncing the SAME id with a new transform mutates the existing
 *     Object3D rather than creating a fresh one (reference stability).
 *   - sync({}) after sync({a}) removes the node from root.
 *   - raycastInstance returns the instance id when hitting a prefab.
 *
 * Note on the cube prefab: its build() wraps the mesh in a Group so the
 * mesh keeps its local +4 y-offset (so the cube's BASE sits on the
 * placement point — half of the 8m cube height). The raycast test
 * asserts we resolve to the instanceId on the Group ancestor, not the
 * inner Mesh.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";

import type { InstanceObject } from "../state/mapStore";
import { PrefabRenderer } from "./PrefabRenderer";

function makeInstance(id: string, x = 0, z = 0): InstanceObject {
  return {
    id,
    prefabId: "cube",
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    properties: {},
  };
}

describe("PrefabRenderer", () => {
  let renderer: PrefabRenderer;

  beforeEach(() => {
    renderer = new PrefabRenderer();
  });

  it("sync({}) leaves the root empty", () => {
    renderer.sync({});
    expect(renderer.root.children.length).toBe(0);
  });

  it("sync({a}) adds one node tagged with the instance id", () => {
    const a = makeInstance("a", 10, 20);
    renderer.sync({ a });
    expect(renderer.root.children.length).toBe(1);
    const node = renderer.getNode("a");
    expect(node).not.toBeNull();
    expect(node!.userData.instanceId).toBe("a");
    expect(node!.position.x).toBe(10);
    expect(node!.position.z).toBe(20);
  });

  it("sync({a, b}) adds two nodes", () => {
    const a = makeInstance("a");
    const b = makeInstance("b", 5, 5);
    renderer.sync({ a, b });
    expect(renderer.root.children.length).toBe(2);
    expect(renderer.getNode("a")).not.toBeNull();
    expect(renderer.getNode("b")).not.toBeNull();
  });

  it("re-syncing an existing id mutates the same Object3D (no rebuild)", () => {
    const a = makeInstance("a", 0, 0);
    renderer.sync({ a });
    const before = renderer.getNode("a");
    expect(before).not.toBeNull();

    const aMoved: InstanceObject = {
      ...a,
      position: { x: 42, y: 1, z: 3 },
    };
    renderer.sync({ a: aMoved });
    const after = renderer.getNode("a");
    // Same Object3D reference — transform was mutated, not replaced.
    expect(after).toBe(before);
    expect(after!.position.x).toBe(42);
    expect(after!.position.y).toBe(1);
    expect(after!.position.z).toBe(3);
    expect(renderer.root.children.length).toBe(1);
  });

  it("sync({}) after sync({a}) removes the node", () => {
    const a = makeInstance("a");
    renderer.sync({ a });
    expect(renderer.root.children.length).toBe(1);
    renderer.sync({});
    expect(renderer.root.children.length).toBe(0);
    expect(renderer.getNode("a")).toBeNull();
  });

  it("raycastInstance returns the instance id when hitting a prefab", () => {
    const a = makeInstance("a", 0, 0);
    renderer.sync({ a });
    // Point a ray straight down at the cube placement point. The cube
    // mesh inside the Group sits at local y=1 with half-height 1, so
    // the top face is at world y=2. Aim from y=10 looking down -Y.
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 10, 0),
      new THREE.Vector3(0, -1, 0).normalize(),
    );
    const hitId = renderer.raycastInstance(raycaster);
    expect(hitId).toBe("a");
  });

  it("raycastInstance returns null when the ray misses every prefab", () => {
    const a = makeInstance("a", 0, 0);
    renderer.sync({ a });
    // Point a ray away from any prefab.
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(100, 10, 100),
      new THREE.Vector3(0, 1, 0).normalize(),
    );
    const hitId = renderer.raycastInstance(raycaster);
    expect(hitId).toBeNull();
  });

  it("dispose clears state and frees resources without throwing", () => {
    renderer.sync({ a: makeInstance("a") });
    expect(() => renderer.dispose()).not.toThrow();
    expect(renderer.getNode("a")).toBeNull();
    expect(renderer.root.children.length).toBe(0);
  });
});
