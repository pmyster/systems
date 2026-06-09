/**
 * Regression test — sparse-schema canon_01.json must parse cleanly.
 *
 * This test is the canary against the "I hand-authored a minimal turret
 * schematic and the editor renders empty" failure mode. canon_01 is a
 * sparse schematic (rig=[], one weapon part, one mesh hardpoint, no
 * voxel_data) — exactly the shape that previously triggered silent
 * undefined-access crashes in sub-components.
 *
 * The richer mk01 schematic is also re-validated here so a future schema
 * change that breaks the sparse case but happens to leave mk01 working
 * still fails the gate.
 *
 * Filename leads with __ so it stays grouped with similar
 * "regression-only, no namespace" gate tests near the top of the
 * vitest run output.
 */

import { describe, expect, it } from "vitest";

import { UnitSchematicSchema } from "./lib/zod-schemas";

// Vite handles `?raw` imports — the bundler returns the file's text as a
// string. Resolving via `../../units/...` reaches the repo-level unit
// files without needing the Node fs/path types in tsconfig.
import canon01Raw from "../../units/player/canon_01.json?raw";
import mk01Raw from "../../units/player/mk01.json?raw";

function loadJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

describe("sparse-schema units load cleanly", () => {
  it("canon_01.json — empty rig + single mesh hardpoint + single weapon part parses", () => {
    const r = UnitSchematicSchema.safeParse(loadJson(canon01Raw));
    if (!r.success) {
      // Surface every issue so a future drift is immediately diagnosable.
      const issues = r.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`canon_01.json failed schema:\n${issues}`);
    }
    expect(r.success).toBe(true);
  });

  it("mk01.json — richer reference unit still parses (regression guard)", () => {
    const r = UnitSchematicSchema.safeParse(loadJson(mk01Raw));
    if (!r.success) {
      const issues = r.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`mk01.json failed schema:\n${issues}`);
    }
    expect(r.success).toBe(true);
  });
});
