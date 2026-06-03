/**
 * Tests for composerOverrides.applyComposerOverridesToTree.
 *
 * Strategy: build a fake GLTF scene root (THREE.Group containing N named
 * Meshes) and feed it a sidecar that overrides one of them. Assert:
 *   - The overridden mesh's local transform matches the sidecar.
 *   - The OTHER meshes are untouched.
 *   - Missing-name overrides fire the diagnostic callback (and don't
 *     throw — they're partial-failure-tolerant by design).
 *   - The applier is idempotent: running twice produces the same result.
 */

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";

import { applyComposerOverridesToTree } from "./composerOverrides";
import type { ComposerSidecar } from "../../components/UnitEditor/MeshComposer/composerSidecar";

function makeFakeGltfRoot(): THREE.Group {
  const root = new THREE.Group();
  root.name = "scene_root";
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const a = new THREE.Mesh(geom, mat);
  a.name = "chassis_body";
  a.position.set(0, 0, 0);
  const b = new THREE.Mesh(geom, mat);
  b.name = "barrel_lower";
  b.position.set(0, 1, 0);
  const c = new THREE.Mesh(geom, mat);
  c.name = "barrel_upper";
  c.position.set(0, 2, 0);
  root.add(a, b, c);
  return root;
}

describe("applyComposerOverridesToTree", () => {
  it("applies overrides to the named sub-mesh only; others untouched", () => {
    const root = makeFakeGltfRoot();
    const sidecar: ComposerSidecar = {
      version: 1,
      unit_id: "test_unit",
      submesh_overrides: {
        barrel_lower: {
          position: [0.5, 1.5, -0.25],
          rotation_quat: [0, 0.7071, 0, 0.7071],
          scale: [1.1, 1.1, 1.1],
          visible: true,
        },
      },
    };

    const applied = applyComposerOverridesToTree(root, sidecar);

    expect(applied).toEqual(new Set(["barrel_lower"]));

    // Find the meshes by name to check.
    const meshes = new Map<string, THREE.Mesh>();
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) meshes.set(node.name, node);
    });

    const lower = meshes.get("barrel_lower");
    expect(lower).toBeDefined();
    if (!lower) return;
    expect(lower.position.x).toBeCloseTo(0.5);
    expect(lower.position.y).toBeCloseTo(1.5);
    expect(lower.position.z).toBeCloseTo(-0.25);
    expect(lower.quaternion.y).toBeCloseTo(0.7071);
    expect(lower.quaternion.w).toBeCloseTo(0.7071);
    expect(lower.scale.x).toBeCloseTo(1.1);

    // chassis_body left at origin (rest pose).
    const body = meshes.get("chassis_body");
    expect(body?.position.x).toBe(0);
    expect(body?.position.y).toBe(0);
    expect(body?.scale.x).toBe(1);

    // barrel_upper left at (0, 2, 0) (rest pose).
    const upper = meshes.get("barrel_upper");
    expect(upper?.position.y).toBe(2);
  });

  it("warns + reports via diagnostic when sidecar references missing names", () => {
    const root = makeFakeGltfRoot();
    const sidecar: ComposerSidecar = {
      version: 1,
      unit_id: "test_unit",
      submesh_overrides: {
        chassis_body: {
          position: [0, 0.5, 0],
          rotation_quat: [0, 0, 0, 1],
          scale: [1, 1, 1],
          visible: true,
        },
        not_in_glb: {
          position: [99, 99, 99],
          rotation_quat: [0, 0, 0, 1],
          scale: [1, 1, 1],
          visible: true,
        },
      },
    };

    const diagnostics: Array<{ message: string; detail?: unknown }> = [];
    // Spy on console.warn so the test confirms the loud-over-silent path.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const applied = applyComposerOverridesToTree(root, sidecar, (d) =>
      diagnostics.push({ message: d.message, detail: d.detail }),
    );

    // The applied set has only the matching name.
    expect(applied).toEqual(new Set(["chassis_body"]));
    // Diagnostic with the missing name + the available names.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("not_in_glb");
    expect(diagnostics[0].message).toContain("chassis_body");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    // The chassis_body override DID still apply.
    const meshes = new Map<string, THREE.Mesh>();
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) meshes.set(node.name, node);
    });
    expect(meshes.get("chassis_body")?.position.y).toBeCloseTo(0.5);
  });

  it("is idempotent: re-applying produces the same final state", () => {
    const root = makeFakeGltfRoot();
    const sidecar: ComposerSidecar = {
      version: 1,
      unit_id: "test_unit",
      submesh_overrides: {
        chassis_body: {
          position: [1, 2, 3],
          rotation_quat: [0, 0, 0, 1],
          scale: [2, 2, 2],
          visible: true,
        },
      },
    };
    applyComposerOverridesToTree(root, sidecar);
    applyComposerOverridesToTree(root, sidecar);

    const body = root.children.find(
      (n) => n instanceof THREE.Mesh && n.name === "chassis_body",
    ) as THREE.Mesh | undefined;
    expect(body?.position.x).toBe(1);
    expect(body?.position.y).toBe(2);
    expect(body?.position.z).toBe(3);
    expect(body?.scale.x).toBe(2);
  });

  it("hides a sub-mesh when visible: false by removing it from its parent", () => {
    const root = makeFakeGltfRoot();
    const sidecar: ComposerSidecar = {
      version: 1,
      unit_id: "test_unit",
      submesh_overrides: {
        barrel_upper: {
          position: [0, 2, 0],
          rotation_quat: [0, 0, 0, 1],
          scale: [1, 1, 1],
          visible: false,
        },
      },
    };
    applyComposerOverridesToTree(root, sidecar);

    // After application, barrel_upper should no longer be a child of root —
    // it was detached so the InstancedUnitRenderer's traverse() skips it.
    const childNames = root.children
      .filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
      .map((c) => c.name);
    expect(childNames).not.toContain("barrel_upper");
    expect(childNames).toContain("chassis_body");
    expect(childNames).toContain("barrel_lower");
  });

  it("returns an empty set when sidecar overrides is empty", () => {
    const root = makeFakeGltfRoot();
    const applied = applyComposerOverridesToTree(root, {
      version: 1,
      unit_id: "x",
      submesh_overrides: {},
    });
    expect(applied.size).toBe(0);
  });
});
