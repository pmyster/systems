/**
 * Vitest coverage for PlaceObjectCommand.
 *
 * Coverage:
 *   - do() inserts the object into the store under the supplied id.
 *   - undo() removes it.
 *   - The id is stable across undo→redo (never regenerated).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useMapStore } from "../state/mapStore";
import type { InstanceObject } from "../state/mapStore";
import { PlaceObjectCommand } from "./PlaceObjectCommand";

function resetObjects(): void {
  useMapStore.setState({ objects: {} });
}

function makeFixture(): InstanceObject {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    prefabId: "rock_01",
    position: { x: 10, y: 0, z: 10 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    properties: { tag: "fixture" },
  };
}

describe("PlaceObjectCommand", () => {
  beforeEach(() => {
    resetObjects();
  });

  it("do() inserts the object", () => {
    const obj = makeFixture();
    const cmd = new PlaceObjectCommand(obj);
    cmd.do();
    expect(useMapStore.getState().objects[obj.id]).toEqual(obj);
  });

  it("undo() removes the object", () => {
    const obj = makeFixture();
    const cmd = new PlaceObjectCommand(obj);
    cmd.do();
    cmd.undo();
    expect(useMapStore.getState().objects[obj.id]).toBeUndefined();
  });

  it("preserves the id across undo→redo", () => {
    const obj = makeFixture();
    const cmd = new PlaceObjectCommand(obj);
    cmd.do();
    cmd.undo();
    cmd.do();
    const stored = useMapStore.getState().objects[obj.id];
    expect(stored.id).toBe(obj.id);
    expect(stored).toEqual(obj);
  });
});
