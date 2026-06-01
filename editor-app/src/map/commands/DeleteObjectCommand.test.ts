/**
 * Vitest coverage for DeleteObjectCommand.
 *
 * Coverage:
 *   - do() removes the object.
 *   - undo() restores it with the SAME id and full snapshot.
 *   - construction from a string id snapshots the current store value.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useMapStore } from "../state/mapStore";
import type { InstanceObject } from "../state/mapStore";
import { DeleteObjectCommand } from "./DeleteObjectCommand";

function reset(): void {
  useMapStore.setState({ objects: {} });
}

const FIXTURE: InstanceObject = {
  id: "22222222-2222-2222-2222-222222222222",
  prefabId: "tree_pine",
  position: { x: 3, y: 0, z: 4 },
  rotation: { x: 0, y: 0.5, z: 0 },
  scale: { x: 1, y: 1.2, z: 1 },
  properties: { health: 10 },
};

function seed(): void {
  useMapStore.getState()._setObjects({ [FIXTURE.id]: FIXTURE });
}

describe("DeleteObjectCommand", () => {
  beforeEach(() => {
    reset();
    seed();
  });

  it("do() removes the object", () => {
    const cmd = new DeleteObjectCommand(FIXTURE.id);
    cmd.do();
    expect(useMapStore.getState().objects[FIXTURE.id]).toBeUndefined();
  });

  it("undo() restores the object with full fidelity", () => {
    const cmd = new DeleteObjectCommand(FIXTURE.id);
    cmd.do();
    cmd.undo();
    expect(useMapStore.getState().objects[FIXTURE.id]).toEqual(FIXTURE);
  });

  it("snapshots the current store value when given an id at construction", () => {
    const cmd = new DeleteObjectCommand(FIXTURE.id);
    // Mutate the store after construction; undo should still restore the
    // snapshot taken at construction time, not the post-mutation value.
    useMapStore.getState()._setObjects({});
    cmd.do(); // no-op (already removed)
    cmd.undo();
    expect(useMapStore.getState().objects[FIXTURE.id]).toEqual(FIXTURE);
  });

  it("throws if the id doesn't exist in the store at construction", () => {
    expect(() => new DeleteObjectCommand("does-not-exist")).toThrow();
  });
});
