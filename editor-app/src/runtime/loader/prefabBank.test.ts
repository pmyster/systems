/**
 * Tests for PrefabBank.
 *
 * Templates ("tank", "mech", …) are real (they're pure procedural Three.js,
 * no IO). File-based refs need `loadMeshFromPath` mocked because that
 * function calls into Tauri to read disk bytes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

vi.mock("../../components/MeshWorkspace/mesh-loader", () => ({
  loadMeshFromPath: vi.fn(),
}));
// Tauri shouldn't be reached for template-only paths, but the
// mesh-loader module imports invoke at the top — mock it to be safe.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { loadMeshFromPath } from "../../components/MeshWorkspace/mesh-loader";
import { PrefabBank, meshAssetKey } from "./prefabBank";

const mockedLoadMesh = loadMeshFromPath as unknown as ReturnType<typeof vi.fn>;

describe("meshAssetKey", () => {
  it("encodes template refs distinct from file refs at the same string", () => {
    const t = meshAssetKey({ kind: "template", template_id: "tank" });
    const f = meshAssetKey({ kind: "file", path: "tank" });
    expect(t).not.toBe(f);
  });

  it("returns identical keys for identical refs", () => {
    const a = meshAssetKey({ kind: "template", template_id: "tank" });
    const b = meshAssetKey({ kind: "template", template_id: "tank" });
    expect(a).toBe(b);
  });
});

describe("PrefabBank.load", () => {
  beforeEach(() => {
    mockedLoadMesh.mockReset();
  });

  it("loads a template by id and caches it", async () => {
    const bank = new PrefabBank();
    const ref = { kind: "template", template_id: "tank" } as const;
    const a = await bank.load(ref);
    const b = await bank.load(ref);
    expect(a).toBe(b); // same cached reference
    expect(bank.size()).toBe(1);
    bank.dispose();
  });

  it("throws on unknown template id", async () => {
    const bank = new PrefabBank();
    await expect(
      bank.load({ kind: "template", template_id: "nonexistent_template" }),
    ).rejects.toThrow(/unknown template/);
    bank.dispose();
  });

  it("dedups concurrent loads of the same file ref", async () => {
    // The mock returns a fresh Group after a microtask. If concurrent
    // loads were not deduped, mockedLoadMesh would be called twice; we
    // assert it was called exactly once.
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    mockedLoadMesh.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return group;
    });

    const bank = new PrefabBank();
    const ref = { kind: "file", path: "/fake/tank.glb" } as const;
    const [a, b] = await Promise.all([bank.load(ref), bank.load(ref)]);
    expect(a).toBe(b);
    expect(mockedLoadMesh).toHaveBeenCalledTimes(1);
    bank.dispose();
  });

  it("caches a file ref across sequential loads", async () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    mockedLoadMesh.mockResolvedValue(group);
    const bank = new PrefabBank();
    const ref = { kind: "file", path: "/fake/scout.glb" } as const;
    await bank.load(ref);
    await bank.load(ref);
    expect(mockedLoadMesh).toHaveBeenCalledTimes(1);
    expect(bank.has(ref)).toBe(true);
    expect(bank.get(ref)).toBe(group);
    bank.dispose();
  });

  it("treats template and file refs with the same string as distinct entries", async () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    mockedLoadMesh.mockResolvedValue(group);
    const bank = new PrefabBank();
    await bank.load({ kind: "template", template_id: "tank" });
    await bank.load({ kind: "file", path: "tank" });
    expect(bank.size()).toBe(2);
    bank.dispose();
  });

  it("clears the cache on dispose", async () => {
    const bank = new PrefabBank();
    await bank.load({ kind: "template", template_id: "tank" });
    expect(bank.size()).toBe(1);
    bank.dispose();
    expect(bank.size()).toBe(0);
  });
});
