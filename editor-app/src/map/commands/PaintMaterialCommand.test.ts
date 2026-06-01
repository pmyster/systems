/**
 * Vitest coverage for PaintMaterialCommand.
 *
 * Coverage:
 *   - do() shifts splatmap RGBA bytes toward the target material.
 *   - undo() restores the exact pre-paint bytes.
 *   - merge() collapses same-material consecutive ticks.
 *   - merge() refuses cross-material ticks.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { _resetMapStore, useMapStore } from "../state/mapStore";

import { PaintMaterialCommand } from "./PaintMaterialCommand";

describe("PaintMaterialCommand", () => {
  beforeEach(() => {
    _resetMapStore();
  });

  it("do() raises the target channel and lowers others (proportional)", () => {
    // Default splatmap is all (255, 0, 0, 0) — pure grass. Paint sand
    // (material 2) at center; expect B channel up, R channel down at the
    // brush center.
    const state = useMapStore.getState();
    const w = state.splatmap.widthPx;
    const cx = Math.floor(w / 2);
    const cy = Math.floor(state.splatmap.heightPx / 2);
    const centerIdx = (cy * w + cx) * 4;
    const beforeR = state.splatmap.data[centerIdx + 0];
    const beforeB = state.splatmap.data[centerIdx + 2];
    expect(beforeR).toBe(255);
    expect(beforeB).toBe(0);

    new PaintMaterialCommand({
      centerPxX: cx,
      centerPxY: cy,
      radiusPx: 4,
      strength: 1,
      materialIndex: 2,
    }).do();

    const after = useMapStore.getState().splatmap.data;
    expect(after[centerIdx + 2]).toBeGreaterThan(beforeB);
    expect(after[centerIdx + 0]).toBeLessThan(beforeR);
  });

  it("undo() restores the exact pre-paint bytes", () => {
    const state = useMapStore.getState();
    const cx = 10;
    const cy = 10;
    const beforeSnapshot = new Uint8Array(state.splatmap.data);
    const cmd = new PaintMaterialCommand({
      centerPxX: cx,
      centerPxY: cy,
      radiusPx: 3,
      strength: 0.5,
      materialIndex: 1,
    });
    cmd.do();
    cmd.undo();
    const after = useMapStore.getState().splatmap.data;
    // Compare each byte rather than reference equality (the underlying
    // buffer is mutated in place — same reference, different contents
    // mid-test, identical contents post-undo).
    expect(Array.from(after)).toEqual(Array.from(beforeSnapshot));
  });

  it("merge() collapses two same-material ticks", () => {
    const cmdA = new PaintMaterialCommand({
      centerPxX: 5,
      centerPxY: 5,
      radiusPx: 2,
      strength: 0.4,
      materialIndex: 3,
    });
    const cmdB = new PaintMaterialCommand({
      centerPxX: 6,
      centerPxY: 5,
      radiusPx: 2,
      strength: 0.4,
      materialIndex: 3,
    });
    cmdA.do();
    cmdB.do();
    const merged = cmdA.merge?.(cmdB);
    expect(merged).toBe(true);

    // After merge, undoing cmdA should restore the FULL pre-stroke state
    // — including pixels that only cmdB touched.
    const preMergeState = new Uint8Array(useMapStore.getState().splatmap.data);
    cmdA.undo();
    const restored = useMapStore.getState().splatmap.data;
    // Every byte we changed back to default-grass (255, 0, 0, 0) initial.
    for (let i = 0; i < restored.length; i += 4) {
      expect(restored[i]).toBe(255);
      expect(restored[i + 1]).toBe(0);
      expect(restored[i + 2]).toBe(0);
      expect(restored[i + 3]).toBe(0);
    }
    // Sanity: the merged-do-state was not all-default before undo.
    let anyNonDefault = false;
    for (let i = 0; i < preMergeState.length; i += 4) {
      if (preMergeState[i + 3] !== 0) {
        anyNonDefault = true;
        break;
      }
    }
    expect(anyNonDefault).toBe(true);
  });

  it("merge() refuses cross-material ticks", () => {
    const cmdA = new PaintMaterialCommand({
      centerPxX: 5,
      centerPxY: 5,
      radiusPx: 2,
      strength: 0.4,
      materialIndex: 1,
    });
    const cmdB = new PaintMaterialCommand({
      centerPxX: 5,
      centerPxY: 5,
      radiusPx: 2,
      strength: 0.4,
      materialIndex: 2,
    });
    expect(cmdA.merge?.(cmdB)).toBe(false);
  });
});
