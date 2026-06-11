/**
 * Vitest coverage for PlaceDecalCommand — basic do/undo round-trip.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useMapStore } from "../state/mapStore";
import type { DecalInstance } from "../state/mapStore";
import { PlaceDecalCommand } from "./PlaceDecalCommand";

function reset(): void {
  useMapStore.setState({ decals: {} });
}

const FIXTURE: DecalInstance = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  decalKind: "scorch",
  position: { x: 4, y: 0, z: 8 },
  rotation: 0.5,
  scale: 1.2,
  opacity: 0.7,
};

describe("PlaceDecalCommand", () => {
  beforeEach(() => {
    reset();
  });

  it("do() inserts the decal", () => {
    const cmd = new PlaceDecalCommand(FIXTURE);
    cmd.do();
    expect(useMapStore.getState().decals[FIXTURE.id]).toEqual(FIXTURE);
  });

  it("undo() removes the decal", () => {
    const cmd = new PlaceDecalCommand(FIXTURE);
    cmd.do();
    cmd.undo();
    expect(useMapStore.getState().decals[FIXTURE.id]).toBeUndefined();
  });

  it("preserves the id across undo→redo", () => {
    const cmd = new PlaceDecalCommand(FIXTURE);
    cmd.do();
    cmd.undo();
    cmd.do();
    expect(useMapStore.getState().decals[FIXTURE.id]).toEqual(FIXTURE);
  });
});
