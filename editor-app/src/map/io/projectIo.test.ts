/**
 * Vitest coverage for projectIo bundle round-tripping.
 *
 * Day 5 add: assert that placed objects survive a save/load round-trip
 * (build → manifest JSON parse → re-validate via the Zod schema). We
 * verify the public bundle shape rather than invoking the Tauri-backed
 * load path because that needs a Tauri runtime.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { MapProjectManifestSchema } from "../schema/manifest";
import { useMapStore } from "../state/mapStore";
import type { InstanceObject } from "../state/mapStore";

import { _buildBundleFromStore } from "./projectIo";

const OBJ: InstanceObject = {
  id: "55555555-5555-5555-5555-555555555555",
  prefabId: "cube",
  position: { x: 12.5, y: 3.25, z: -7.75 },
  rotation: { x: 0, y: 1.5708, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  properties: { tag: "test" },
};

describe("projectIo bundle round-trip", () => {
  beforeEach(() => {
    useMapStore.setState({
      objects: {},
      spawnPoints: {},
      selection: { kind: "none", id: null },
    });
  });

  it("places an object into the manifest with full transform fidelity", () => {
    useMapStore.setState({ objects: { [OBJ.id]: OBJ } });
    const bundle = _buildBundleFromStore();
    const parsed = JSON.parse(bundle.manifest_json);
    const manifest = MapProjectManifestSchema.parse(parsed);
    expect(manifest.objects).toHaveLength(1);
    const out = manifest.objects[0];
    expect(out.id).toBe(OBJ.id);
    expect(out.prefabId).toBe(OBJ.prefabId);
    expect(out.position).toEqual(OBJ.position);
    expect(out.rotation).toEqual(OBJ.rotation);
    expect(out.scale).toEqual(OBJ.scale);
    expect(out.properties).toEqual(OBJ.properties);
  });

  it("emits an empty objects array when no objects are placed", () => {
    const bundle = _buildBundleFromStore();
    const parsed = JSON.parse(bundle.manifest_json);
    const manifest = MapProjectManifestSchema.parse(parsed);
    expect(manifest.objects).toEqual([]);
  });
});
