/**
 * Smoke tests — the Unit Editor's three panes must render against a
 * sparse, hand-authored schematic without throwing.
 *
 * The "editor goes empty when you load a sparse unit" failure mode comes
 * from sub-components that assume rich data (e.g. a 5-entry rig, a part
 * with weapon_timing_ms fields, voxel_data on the chassis). Each crash
 * lands inside a React render boundary and silently empties the pane.
 *
 * This file mounts AttributeForm against `canon_01.json` (sparse) and
 * `mk01.json` (richer) and asserts neither renders throws. We're not
 * asserting visual correctness here — that's the human eye in
 * BattlefieldPreview. We're asserting "the form does not crash on a
 * sparse schematic", which is the contract the user explicitly named.
 *
 * The file leads with __ so it sorts at the top of the vitest output
 * alongside the other regression gates.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AttributeForm } from "./components/AttributeForm";
import { MeshAssetProvider } from "./state/mesh-assets";
import type { UnitSchematic } from "./types/unit";

// `?raw` is a Vite-native suffix that imports the file as a string.
// Avoids the node fs/path types that aren't included in tsconfig.json
// (the editor-app uses bundler module resolution, not Node).
import canon01Raw from "../../units/player/canon_01.json?raw";
import mk01Raw from "../../units/player/mk01.json?raw";

function parseUnit(raw: string): UnitSchematic {
  return JSON.parse(raw) as UnitSchematic;
}

describe("Unit Editor renders against sparse schematics", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  function renderAttribute(unit: UnitSchematic): void {
    act(() => {
      root.render(
        <MeshAssetProvider>
          <AttributeForm unit={unit} onUnitChange={() => {}} />
        </MeshAssetProvider>,
      );
    });
  }

  it("AttributeForm renders against canon_01 (sparse: empty rig, single weapon, no voxels)", () => {
    const unit = parseUnit(canon01Raw);
    expect(() => renderAttribute(unit)).not.toThrow();
    // Sanity: the form actually produced DOM, not a thrown-and-swallowed empty root.
    expect(container.querySelector("section")).not.toBeNull();
  });

  it("AttributeForm renders against mk01 (richer reference unit)", () => {
    const unit = parseUnit(mk01Raw);
    expect(() => renderAttribute(unit)).not.toThrow();
    expect(container.querySelector("section")).not.toBeNull();
  });
});
