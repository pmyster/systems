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
 *
 * Refresh button:
 *   The user-prefab drop folder (`public/prefabs/user/`) can grow at any
 *   time — the user drops a new .glb, comes back to the editor, and
 *   wants the new prefab in the list without a full F5. The Refresh
 *   button re-invokes `loadPrefabManifest`, which dedupes against
 *   already-loaded ids and only does I/O for genuinely new files.
 */

import { useEffect, useState } from "react";

import { loadPrefabManifest } from "../../map/scene/prefabLoader";
import { prefabRegistry } from "../../map/scene/prefabs";
import { useMapStore } from "../../map/state/mapStore";

export function PrefabLibraryPanel() {
  const tool = useMapStore((s) => s.tool);
  const activePrefabId = useMapStore((s) => s.activePrefabId);
  const setActivePrefabId = useMapStore((s) => s.setActivePrefabId);
  const prefabScaleOverrides = useMapStore((s) => s.prefabScaleOverrides);
  const setPrefabScale = useMapStore((s) => s.setPrefabScale);
  // Force a re-render when async-loaded prefabs register themselves
  // after the initial mount. See file header for the rationale.
  const [, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 500);
    const timeout = setTimeout(() => clearInterval(interval), 5000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadPrefabManifest();
      // Force a re-list from the registry now that any new user prefabs
      // are registered. Same tick mechanism the mount-time polling uses.
      setTick((n) => n + 1);
    } finally {
      setRefreshing(false);
    }
  }

  // Show for both Place and Scatter — both need the user to pick which
  // prefab a click/drag will spawn. Hidden during Sculpt/Select where it
  // would just be noise.
  if (tool !== "place" && tool !== "scatter") return null;
  const prefabs = prefabRegistry.list();
  const activeScale = prefabScaleOverrides[activePrefabId] ?? 1.0;
  // Only show the scale slider when the active prefab actually exists in
  // the registry (avoid a confusing slider for an unregistered id).
  const hasActive = prefabs.some((p) => p.id === activePrefabId);

  return (
    <div className="prefab-library">
      <div className="prefab-library-header">
        <span className="prefab-library-title">Prefabs ({prefabs.length})</span>
        <button
          type="button"
          className="prefab-library-refresh"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Re-scan user prefabs folder"
        >
          {refreshing ? "…" : "⟳"}
        </button>
      </div>
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
      {hasActive ? (
        <div className="prefab-scale-row">
          <label className="prefab-scale-label" htmlFor="prefab-scale-slider">
            Scale: {activeScale.toFixed(2)}x
          </label>
          <input
            id="prefab-scale-slider"
            type="range"
            min={0.25}
            max={4.0}
            step={0.25}
            value={activeScale}
            onChange={(e) =>
              setPrefabScale(activePrefabId, Number(e.target.value))
            }
          />
        </div>
      ) : null}
    </div>
  );
}
