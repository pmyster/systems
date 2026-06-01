/**
 * PrefabLibraryPanel — left-rail prefab picker, only visible while the
 * Place tool is active. Lists every prefab currently in the
 * `prefabRegistry` (built-ins + anything `prefabLoader` registered from
 * the manifest) and lets the user pick which one the next click spawns.
 *
 * Why the polling refresh:
 *   `prefabRegistry` is a plain module singleton (no event emitter) —
 *   when the async GLB loader registers a prefab after the editor
 *   mounts, this component has no React-shaped notification to re-read.
 *   We poll for 5 seconds at 500ms cadence (10 ticks) which covers the
 *   typical "models finish loading within 2-3 seconds" case without
 *   introducing a permanent timer.
 */

import { useEffect, useState } from "react";

import { prefabRegistry } from "../../map/scene/prefabs";
import { useMapStore } from "../../map/state/mapStore";

export function PrefabLibraryPanel() {
  const tool = useMapStore((s) => s.tool);
  const activePrefabId = useMapStore((s) => s.activePrefabId);
  const setActivePrefabId = useMapStore((s) => s.setActivePrefabId);
  // Force a re-render when async-loaded prefabs register themselves
  // after the initial mount. See file header for the rationale.
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 500);
    const timeout = setTimeout(() => clearInterval(interval), 5000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  // Show for both Place and Scatter — both need the user to pick which
  // prefab a click/drag will spawn. Hidden during Sculpt/Select where it
  // would just be noise.
  if (tool !== "place" && tool !== "scatter") return null;
  const prefabs = prefabRegistry.list();

  return (
    <div className="prefab-library">
      <div className="prefab-library-title">Prefabs ({prefabs.length})</div>
      <div className="prefab-list">
        {prefabs.map((p) => (
          <button
            key={p.id}
            type="button"
            className={
              "prefab-list-item" + (p.id === activePrefabId ? " is-active" : "")
            }
            onClick={() => setActivePrefabId(p.id)}
            title={p.id}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
