/**
 * Vitest coverage for ScatterObjectsCommand.
 *
 * Coverage:
 *   - do() inserts every snapshot into the store under its supplied id.
 *   - undo() removes them all (and only them).
 *   - merge() folds a fresh ScatterObjectsCommand's snapshots in, so
 *     undo on the merged command rolls back BOTH batches.
 *   - merge() refuses non-matching command kinds.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useMapStore, type InstanceObject } from "../state/mapStore";
import { ScatterObjectsCommand } from "./ScatterObjectsCommand";
import { PlaceObjectCommand } from "./PlaceObjectCommand";

function resetObjects(): void {
  useMapStore.setState({ objects: {} });
}

function fixtureInstance(idSuffix: string): InstanceObject {
  return {
    id: `00000000-0000-0000-0000-${idSuffix.padStart(12, "0")}`,
    prefabId: "rock_01",
    position: { x: Math.random() * 100, y: 0, z: Math.random() * 100 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    properties: {},
  };
}

function batch(n: number, startIdx: number): InstanceObject[] {
  return Array.from({ length: n }, (_, i) =>
    fixtureInstance(String(startIdx + i)),
  );
}

describe("ScatterObjectsCommand", () => {
  beforeEach(() => {
    resetObjects();
  });

  it("do() inserts all instances", () => {
    const instances = batch(5, 1);
    const cmd = new ScatterObjectsCommand({ instances });
    cmd.do();
    const stored = useMapStore.getState().objects;
    expect(Object.keys(stored)).toHaveLength(5);
    for (const inst of instances) {
      expect(stored[inst.id]).toEqual(inst);
    }
  });

  it("undo() removes all instances", () => {
    const instances = batch(5, 1);
    const cmd = new ScatterObjectsCommand({ instances });
    cmd.do();
    cmd.undo();
    expect(Object.keys(useMapStore.getState().objects)).toHaveLength(0);
  });

  it("merge() combines two batches and undo rolls back both", () => {
    const first = new ScatterObjectsCommand({ instances: batch(3, 1) });
    const second = new ScatterObjectsCommand({ instances: batch(2, 100) });
    first.do();
    second.do();
    expect(Object.keys(useMapStore.getState().objects)).toHaveLength(5);

    const merged = first.merge!(second);
    expect(merged).toBe(true);

    // Now first owns all 5 — undoing it should empty the store.
    first.undo();
    expect(Object.keys(useMapStore.getState().objects)).toHaveLength(0);

    // Redo via the merged command's do() restores all 5.
    first.do();
    expect(Object.keys(useMapStore.getState().objects)).toHaveLength(5);
  });

  it("merge() refuses non-matching command kinds", () => {
    const scatter = new ScatterObjectsCommand({ instances: batch(2, 1) });
    const place = new PlaceObjectCommand(fixtureInstance("999"));
    expect(scatter.merge!(place)).toBe(false);
  });
});
