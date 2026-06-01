/**
 * Vitest coverage for LowerTerrainCommand.
 *
 * Coverage:
 *   - do() lowers the heightmap below baseline at the brush center.
 *   - undo() restores the exact pre-edit heightmap.
 *   - merge only accepts other LowerTerrainCommands.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useMapStore, _resetMapStore, _drainDirty } from "../state/mapStore";
import { LowerTerrainCommand } from "./LowerTerrainCommand";
import { RaiseTerrainCommand } from "./RaiseTerrainCommand";

describe("LowerTerrainCommand", () => {
  beforeEach(() => {
    _resetMapStore();
    _drainDirty();
    // start at 1m so we can see lower clearly
    useMapStore.getState().terrain.heightmap.fill(1);
  });

  it("lowers terrain below baseline at the brush center", () => {
    const cmd = new LowerTerrainCommand({
      worldX: 32,
      worldZ: 32,
      radiusM: 3,
      strength: 0.5,
      timestamp: 1000,
    });
    cmd.do();
    const s = useMapStore.getState();
    const idx = 32 * s.terrain.widthPx + 32;
    expect(s.terrain.heightmap[idx]).toBeLessThan(1);
  });

  it("undo restores the exact pre-edit heightmap", () => {
    const before = new Float32Array(useMapStore.getState().terrain.heightmap);
    const cmd = new LowerTerrainCommand({
      worldX: 32,
      worldZ: 32,
      radiusM: 3,
      strength: 0.5,
      timestamp: 1000,
    });
    cmd.do();
    cmd.undo();
    const after = useMapStore.getState().terrain.heightmap;
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBe(before[i]);
    }
  });

  it("merge rejects a RaiseTerrainCommand", () => {
    const lower = new LowerTerrainCommand({
      worldX: 32,
      worldZ: 32,
      radiusM: 3,
      strength: 0.5,
      timestamp: 1000,
    });
    lower.do();
    const raise = new RaiseTerrainCommand({
      worldX: 32,
      worldZ: 32,
      radiusM: 3,
      strength: 0.5,
      timestamp: 1100,
    });
    expect(lower.merge(raise)).toBe(false);
  });
});
