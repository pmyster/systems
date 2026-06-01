/**
 * Vitest coverage for DeleteDecalCommand — basic do/undo round-trip.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useMapStore } from "../state/mapStore";
import type { DecalInstance } from "../state/mapStore";
import { DeleteDecalCommand } from "./DeleteDecalCommand";

function reset(): void {
  useMapStore.setState({ decals: {} });
}

const FIXTURE: DecalInstance = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  decalKind: "tire_track",
  position: { x: 3, y: 0, z: 4 },
  rotation: 1.2,
  scale: 1,
  opacity: 0.6,
};

function seed(): void {
  useMapStore.getState()._setDecals({ [FIXTURE.id]: FIXTURE });
}

describe("DeleteDecalCommand", () => {
  beforeEach(() => {
    reset();
    seed();
  });

  it("do() removes the decal", () => {
    const cmd = new DeleteDecalCommand(FIXTURE.id);
    cmd.do();
    expect(useMapStore.getState().decals[FIXTURE.id]).toBeUndefined();
  });

  it("undo() restores the decal", () => {
    const cmd = new DeleteDecalCommand(FIXTURE.id);
    cmd.do();
    cmd.undo();
    expect(useMapStore.getState().decals[FIXTURE.id]).toEqual(FIXTURE);
  });

  it("throws if the id is not in the store at construction", () => {
    expect(() => new DeleteDecalCommand("not-a-real-id")).toThrow();
  });
});
