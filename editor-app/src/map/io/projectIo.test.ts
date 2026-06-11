/**
 * Vitest coverage for projectIo bundle round-tripping.
 *
 * Day 5 add: assert that placed objects survive a save/load round-trip
 * (build → manifest JSON parse → re-validate via the Zod schema). We
 * verify the public bundle shape rather than invoking the Tauri-backed
 * load path because that needs a Tauri runtime.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { MapProjectManifestSchema } from "../schema/manifest";
import { useMapStore } from "../state/mapStore";
import type { InstanceObject } from "../state/mapStore";

import { _buildBundleFromStore, mapFilenames } from "./projectIo";

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
      decals: {},
      selection: { kind: "none", id: null },
    });
  });

  it("includes splatmap_bytes sized to widthPx*heightPx*4", () => {
    const bundle = _buildBundleFromStore();
    const sm = useMapStore.getState().splatmap;
    expect(bundle.splatmap_bytes).toHaveLength(sm.widthPx * sm.heightPx * 4);
  });

  it("emits an empty decals array when no decals are placed", () => {
    const bundle = _buildBundleFromStore();
    const parsed = JSON.parse(bundle.manifest_json);
    const manifest = MapProjectManifestSchema.parse(parsed);
    expect(manifest.decals).toEqual([]);
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

// ---------------------------------------------------------------------------
// mapFilenames — name-prefixed asset filenames so the file picker can
// distinguish maps at a glance instead of showing identical `manifest.json`
// entries across every map folder.
// ---------------------------------------------------------------------------
describe("mapFilenames", () => {
  it("prefixes a manifest filename with the map name", () => {
    expect(mapFilenames("Green_Fields", "manifest.json")).toBe(
      "Green_Fields.manifest.json",
    );
  });

  it("prefixes every supported asset suffix", () => {
    const name = "Hot_Sands";
    expect(mapFilenames(name, "heightmap.r32")).toBe("Hot_Sands.heightmap.r32");
    expect(mapFilenames(name, "splatmap.r8")).toBe("Hot_Sands.splatmap.r8");
    expect(mapFilenames(name, "colorpaint.r8")).toBe("Hot_Sands.colorpaint.r8");
    expect(mapFilenames(name, "thumbnail.png")).toBe("Hot_Sands.thumbnail.png");
  });

  it("falls back to 'map' for an empty / whitespace-only name (loud)", () => {
    // Loud-over-silent: empty name would produce a hidden `.manifest.json`
    // on POSIX and an unhelpful picker label everywhere. Fallback keeps
    // the file visible and logs a warning.
    const warn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      expect(mapFilenames("", "manifest.json")).toBe("map.manifest.json");
      expect(mapFilenames("   ", "heightmap.r32")).toBe("map.heightmap.r32");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
