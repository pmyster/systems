/**
 * Vitest coverage for RaiseTerrainCommand.
 *
 * Coverage:
 *   - do() raises the heightmap at the brush center above its starting
 *     value.
 *   - undo() restores the EXACT pre-edit heightmap (byte-identical).
 *   - redo() reapplies the same change.
 *   - merge() with a second stroke at the same position raises further;
 *     undo after merge restores the original baseline in one step.
 *   - terrain revision bumps on do / undo.
 *   - Out-of-bounds brush centers don't crash and don't write.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useMapStore, _resetMapStore, _drainDirty } from "../state/mapStore";
import { RaiseTerrainCommand } from "./RaiseTerrainCommand";

function snapshotHeightmap(): Float32Array {
  return new Float32Array(useMapStore.getState().terrain.heightmap);
}

describe("RaiseTerrainCommand", () => {
  beforeEach(() => {
    _resetMapStore();
    // Drain any pending dirty pixels from a prior test so they don't
    // bleed into subsequent expectations on accumulator state.
    _drainDirty();
  });

  it("raises terrain above baseline at the brush center", () => {
    const cmd = new RaiseTerrainCommand({
      worldX: 64,
      worldZ: 64,
      radiusM: 4,
      strength: 0.5,
      timestamp: 1000,
    });
    cmd.do();
    const s = useMapStore.getState();
    const widthPx = s.terrain.widthPx;
    const centerIdx = 64 * widthPx + 64;
    expect(s.terrain.heightmap[centerIdx]).toBeGreaterThan(0);
    expect(s.terrain.revision).toBe(1);
  });

  it("undo restores the exact pre-edit heightmap", () => {
    const before = snapshotHeightmap();
    const cmd = new RaiseTerrainCommand({
      worldX: 64,
      worldZ: 64,
      radiusM: 4,
      strength: 0.5,
      timestamp: 1000,
    });
    cmd.do();
    cmd.undo();
    const after = snapshotHeightmap();
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBe(before[i]);
    }
  });

  it("redo reapplies the same change exactly", () => {
    const cmd = new RaiseTerrainCommand({
      worldX: 64,
      worldZ: 64,
      radiusM: 4,
      strength: 0.5,
      timestamp: 1000,
    });
    cmd.do();
    const afterFirstDo = snapshotHeightmap();
    cmd.undo();
    cmd.do(); // redo path
    const afterRedo = snapshotHeightmap();
    for (let i = 0; i < afterFirstDo.length; i++) {
      expect(afterRedo[i]).toBe(afterFirstDo[i]);
    }
  });

  it("merge raises further; undo restores the original baseline in one step", () => {
    const before = snapshotHeightmap();
    const cmd1 = new RaiseTerrainCommand({
      worldX: 64,
      worldZ: 64,
      radiusM: 4,
      strength: 0.5,
      timestamp: 1000,
    });
    cmd1.do();
    const afterFirst = snapshotHeightmap();

    const cmd2 = new RaiseTerrainCommand({
      worldX: 64,
      worldZ: 64,
      radiusM: 4,
      strength: 0.5,
      timestamp: 1100,
    });
    const merged = cmd1.merge(cmd2);
    expect(merged).toBe(true);

    const widthPx = useMapStore.getState().terrain.widthPx;
    const centerIdx = 64 * widthPx + 64;
    expect(
      useMapStore.getState().terrain.heightmap[centerIdx],
    ).toBeGreaterThan(afterFirst[centerIdx]);

    // Undoing the merged command should restore the ORIGINAL baseline.
    cmd1.undo();
    const restored = snapshotHeightmap();
    for (let i = 0; i < before.length; i++) {
      expect(restored[i]).toBe(before[i]);
    }
  });

  it("does not crash when the brush center is far off-map", () => {
    const cmd = new RaiseTerrainCommand({
      worldX: -1000,
      worldZ: -1000,
      radiusM: 4,
      strength: 0.5,
      timestamp: 1000,
    });
    expect(() => cmd.do()).not.toThrow();
    // Nothing inside the map should have changed.
    const hm = useMapStore.getState().terrain.heightmap;
    for (let i = 0; i < hm.length; i++) expect(hm[i]).toBe(0);
  });
});
