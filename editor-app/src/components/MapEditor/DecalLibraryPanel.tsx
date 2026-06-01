/**
 * DecalLibraryPanel — left-rail decal picker, visible while the Decal
 * tool is active. Lists every decal kind currently registered with
 * `decalRegistry`.
 */

import { decalRegistry } from "../../map/scene/decals";
import { useMapStore } from "../../map/state/mapStore";

export function DecalLibraryPanel() {
  const tool = useMapStore((s) => s.tool);
  const activeKind = useMapStore((s) => s.activeDecalKind);
  const setActiveKind = useMapStore((s) => s.setActiveDecalKind);

  if (tool !== "decal") return null;

  const kinds = decalRegistry.list();

  return (
    <div className="prefab-library">
      <div className="prefab-library-title">Decals ({kinds.length})</div>
      <div className="prefab-list">
        {kinds.map((k) => (
          <button
            key={k.kind}
            type="button"
            className={
              "prefab-list-item" + (k.kind === activeKind ? " is-active" : "")
            }
            onClick={() => setActiveKind(k.kind)}
            title={k.kind}
          >
            {k.displayName}
          </button>
        ))}
      </div>
    </div>
  );
}
