/**
 * Tests for the Mesh Composer sidecar Zod schema + path helpers.
 *
 * The file I/O paths (`readComposerSidecar`, `writeComposerSidecar`) require
 * Tauri's `invoke` and are exercised via integration tests in the editor;
 * here we exercise the pure pieces: the Zod schema and `sidecarPathFor`.
 */

import { describe, it, expect } from "vitest";

import {
  ComposerSidecarSchema,
  emptySidecar,
  sidecarPathFor,
  type ComposerSidecar,
} from "./composerSidecar";

describe("ComposerSidecarSchema", () => {
  it("accepts a well-formed sidecar", () => {
    const good: ComposerSidecar = {
      version: 1,
      unit_id: "ihor-horholiuk-turret",
      submesh_overrides: {
        chassis_body: {
          position: [0.1, 0.0, -0.4],
          rotation_quat: [0, 0, 0, 1],
          scale: [1, 1, 1],
          visible: true,
        },
        barrel_lower: {
          position: [0, 1.2, 0.7],
          rotation_quat: [0.1, 0, 0, 0.995],
          scale: [0.9, 0.9, 0.9],
          visible: false,
        },
      },
    };
    const parsed = ComposerSidecarSchema.parse(good);
    expect(parsed.unit_id).toBe("ihor-horholiuk-turret");
    expect(Object.keys(parsed.submesh_overrides)).toHaveLength(2);
  });

  it("rejects an unknown version", () => {
    const bad = {
      version: 2,
      unit_id: "x",
      submesh_overrides: {},
    };
    const result = ComposerSidecarSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a missing unit_id", () => {
    const bad = {
      version: 1,
      submesh_overrides: {},
    };
    const result = ComposerSidecarSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects an empty unit_id string", () => {
    const bad = {
      version: 1,
      unit_id: "",
      submesh_overrides: {},
    };
    const result = ComposerSidecarSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects malformed position (not a tuple of 3)", () => {
    const bad = {
      version: 1,
      unit_id: "x",
      submesh_overrides: {
        body: {
          position: [0, 0],
          rotation_quat: [0, 0, 0, 1],
          scale: [1, 1, 1],
          visible: true,
        },
      },
    };
    const result = ComposerSidecarSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const path = result.error.issues[0].path.join(".");
      expect(path).toContain("position");
    }
  });

  it("rejects malformed quaternion (not 4 floats)", () => {
    const bad = {
      version: 1,
      unit_id: "x",
      submesh_overrides: {
        body: {
          position: [0, 0, 0],
          rotation_quat: [0, 0, 0],
          scale: [1, 1, 1],
          visible: true,
        },
      },
    };
    const result = ComposerSidecarSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects missing visible field", () => {
    const bad = {
      version: 1,
      unit_id: "x",
      submesh_overrides: {
        body: {
          position: [0, 0, 0],
          rotation_quat: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      },
    };
    const result = ComposerSidecarSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("round-trips via JSON serialization to identical data", () => {
    const original: ComposerSidecar = {
      version: 1,
      unit_id: "turret",
      submesh_overrides: {
        body: {
          position: [1.5, -0.25, 3.0],
          rotation_quat: [0.0, 0.7071, 0.0, 0.7071],
          scale: [1.05, 1.05, 1.05],
          visible: true,
        },
        barrel: {
          position: [0, 0, 0],
          rotation_quat: [0, 0, 0, 1],
          scale: [1, 1, 1],
          visible: false,
        },
      },
    };
    const text = JSON.stringify(original, null, 2);
    const parsed: unknown = JSON.parse(text);
    const validated = ComposerSidecarSchema.parse(parsed);
    expect(validated).toEqual(original);
    // Re-serialize → must be byte-identical (stable key order is from
    // V8 object iteration, which is insertion order for string keys).
    const reText = JSON.stringify(validated, null, 2);
    expect(reText).toBe(text);
  });

  it("accepts an empty submesh_overrides map", () => {
    const ok: ComposerSidecar = {
      version: 1,
      unit_id: "x",
      submesh_overrides: {},
    };
    const result = ComposerSidecarSchema.safeParse(ok);
    expect(result.success).toBe(true);
  });
});

describe("emptySidecar", () => {
  it("produces a schema-valid sidecar for a given unit id", () => {
    const s = emptySidecar("tank-mk01");
    expect(s.version).toBe(1);
    expect(s.unit_id).toBe("tank-mk01");
    expect(Object.keys(s.submesh_overrides)).toHaveLength(0);
    expect(() => ComposerSidecarSchema.parse(s)).not.toThrow();
  });
});

describe("sidecarPathFor", () => {
  it("replaces .glb with .composer.json (forward slashes)", () => {
    expect(sidecarPathFor("/foo/bar/turret.glb")).toBe(
      "/foo/bar/turret.composer.json",
    );
  });

  it("replaces .glb with .composer.json (windows backslashes)", () => {
    expect(sidecarPathFor("C:\\dev\\game\\turret.glb")).toBe(
      "C:\\dev\\game\\turret.composer.json",
    );
  });

  it("replaces .gltf with .composer.json", () => {
    expect(sidecarPathFor("/x/y/scene.gltf")).toBe("/x/y/scene.composer.json");
  });

  it("is case-insensitive on the extension match", () => {
    expect(sidecarPathFor("/x/y/MODEL.GLB")).toBe("/x/y/MODEL.composer.json");
  });

  it("appends rather than swaps for unrecognised extensions", () => {
    expect(sidecarPathFor("/x/y/strange.obj")).toBe(
      "/x/y/strange.obj.composer.json",
    );
  });
});
