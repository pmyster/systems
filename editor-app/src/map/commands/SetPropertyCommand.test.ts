/**
 * Vitest coverage for SetPropertyCommand.
 *
 * Coverage:
 *   - do() writes the new value at the dotted property path.
 *   - undo() restores the captured pre-edit value.
 *   - Works on both `object` and `spawn` entity kinds.
 *   - Throws on construction if the target entity doesn't exist.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useMapStore } from "../state/mapStore";
import type {
  InstanceObject,
  SpawnPoint,
} from "../state/mapStore";
import { SetPropertyCommand } from "./SetPropertyCommand";

const OBJ: InstanceObject = {
  id: "33333333-3333-3333-3333-333333333333",
  prefabId: "crate",
  position: { x: 1, y: 0, z: 2 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  properties: { hp: 5, label: "alpha" },
};

const SP: SpawnPoint = {
  id: "44444444-4444-4444-4444-444444444444",
  kind: "player",
  position: { x: 0, y: 0, z: 0 },
  facing: 0,
};

function reset(): void {
  useMapStore.setState({
    objects: { [OBJ.id]: OBJ },
    spawnPoints: { [SP.id]: SP },
  });
}

describe("SetPropertyCommand", () => {
  beforeEach(() => {
    reset();
  });

  it("writes a new value into objects at a dotted path", () => {
    const cmd = new SetPropertyCommand({
      entityKind: "object",
      id: OBJ.id,
      propertyPath: "position.x",
      newValue: 99,
    });
    cmd.do();
    expect(useMapStore.getState().objects[OBJ.id].position.x).toBe(99);
  });

  it("undo restores the old value exactly", () => {
    const cmd = new SetPropertyCommand({
      entityKind: "object",
      id: OBJ.id,
      propertyPath: "properties.label",
      newValue: "beta",
    });
    cmd.do();
    cmd.undo();
    expect(useMapStore.getState().objects[OBJ.id].properties.label).toBe(
      "alpha",
    );
  });

  it("works on spawn points", () => {
    const cmd = new SetPropertyCommand({
      entityKind: "spawn",
      id: SP.id,
      propertyPath: "facing",
      newValue: 1.5,
    });
    cmd.do();
    expect(useMapStore.getState().spawnPoints[SP.id].facing).toBe(1.5);
    cmd.undo();
    expect(useMapStore.getState().spawnPoints[SP.id].facing).toBe(0);
  });

  it("throws when the target entity doesn't exist at construction", () => {
    expect(
      () =>
        new SetPropertyCommand({
          entityKind: "object",
          id: "no-such-id",
          propertyPath: "position.x",
          newValue: 0,
        }),
    ).toThrow();
  });
});
