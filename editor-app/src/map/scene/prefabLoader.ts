/**
 * prefabLoader — startup hook that reads `/prefabs/manifest.json` and
 * registers every GLB-backed entry into the shared `prefabRegistry`.
 *
 * Why a manifest instead of a directory scan?
 *   Vite serves `public/` at the document root but doesn't expose a
 *   directory listing — there's no client-side way to ls a folder. A
 *   manifest.json is the canonical workaround: human-curated, lets us
 *   attach per-prefab metadata (category, defaultScale, display name)
 *   alongside the file, and a missing manifest degrades gracefully to
 *   "only the built-in cube is available".
 *
 * Visibility (defensive pattern):
 *   - Manifest fetch failures log at WARN with a clear "fallback to
 *     built-ins" message — silent drops are forbidden.
 *   - Per-entry GLB load failures are isolated; one broken model doesn't
 *     poison the rest. The failed id is surfaced in the return value so
 *     UI can show a banner.
 *
 * Resource hygiene:
 *   - Each placement deep-clones the cached source root and clones every
 *     material so per-instance tints (future) won't bleed across siblings.
 *   - Geometry is shared by clone (no .geometry.clone()) — Three's Mesh
 *     clone reuses the same BufferGeometry which is exactly what we want
 *     for 100s of identical buildings on a map.
 *   - The build() output is wrapped in a Group so PrefabRenderer's
 *     `position.set(...)` overwrites the WRAPPER and the model's
 *     auto-floored offset survives (same pattern as the built-in cube).
 */

import * as THREE from "three";

import { prefabRegistry } from "./prefabs";

// Tauri's invoke is imported lazily-by-presence: when running under the
// editor shell we use it to enumerate the user/ drop folder; when
// running under plain Vite (unit tests, browser-only dev) the import
// resolves but the call throws — we catch and continue.
import { invoke } from "@tauri-apps/api/core";

/**
 * Lazy GLTFLoader getter — dynamic-imports the loader module the first
 * time we need it and caches the resulting instance forever.
 *
 * Why dynamic instead of `import { GLTFLoader } from "..."` at module
 * scope: GLTFLoader pulls in ~80kB of parsing code (including DRACO
 * hooks and KTX2 decoding paths) that the main bundle doesn't need
 * until the user opens a map with GLB prefabs. Vite's code-splitter
 * emits a separate chunk for any `import("...")` call, so this lifts
 * the loader out of the editor's first-paint critical path.
 *
 * The promise is cached at module scope so concurrent prefab loads
 * share one network/parse pass — the second caller just awaits the
 * same promise the first kicked off.
 */
let loaderPromise: Promise<unknown> | null = null;
async function getLoader(): Promise<{ loadAsync(path: string): Promise<{ scene: THREE.Object3D }> }> {
  if (!loaderPromise) {
    loaderPromise = import("three/examples/jsm/loaders/GLTFLoader.js").then(
      (m) => new m.GLTFLoader(),
    );
  }
  return loaderPromise as Promise<{
    loadAsync(path: string): Promise<{ scene: THREE.Object3D }>;
  }>;
}

interface ManifestEntry {
  id: string;
  displayName: string;
  category: string;
  glbPath: string | null;
  defaultScale: { x: number; y: number; z: number };
}

interface PrefabManifest {
  prefabs: ManifestEntry[];
}

// Cache loaded source roots by id so multiple placements share the same
// underlying BufferGeometry (Three's Object3D.clone reuses geometry).
const loadedCache = new Map<string, THREE.Object3D>();

export interface LoadResult {
  loaded: number;
  failed: string[];
  builtins: number;
}

/** Load manifest.json from /prefabs/ and register every entry. */
export async function loadPrefabManifest(): Promise<LoadResult> {
  const failed: string[] = [];
  let loaded = 0;
  let builtins = 0;
  try {
    const res = await fetch("/prefabs/manifest.json");
    if (!res.ok) {
      console.warn(
        "[prefabLoader] No manifest.json at /prefabs/. Only built-in prefabs available.",
      );
      return { loaded: 0, failed: [], builtins: prefabRegistry.list().length };
    }
    const manifest = (await res.json()) as PrefabManifest;
    if (!manifest.prefabs || !Array.isArray(manifest.prefabs)) {
      console.warn(
        "[prefabLoader] manifest.json missing 'prefabs' array. Falling back to built-ins.",
      );
      return { loaded: 0, failed: [], builtins: prefabRegistry.list().length };
    }
    for (const entry of manifest.prefabs) {
      try {
        if (entry.glbPath === null) {
          // Built-in (cube) is already registered in prefabs.ts — skip.
          builtins++;
          continue;
        }
        // Dedup on refresh: the GLB is already cached and registered,
        // so re-running loadPrefabManifest() (from the Refresh button)
        // should be a no-op for static-manifest entries — only newly
        // dropped user/ files do real work.
        if (loadedCache.has(entry.id)) {
          continue;
        }
        await registerGlbPrefab(entry);
        loaded++;
      } catch (e) {
        console.warn(
          `[prefabLoader] Failed to load '${entry.id}' from ${entry.glbPath}:`,
          e,
        );
        failed.push(entry.id);
      }
    }
  } catch (e) {
    console.warn("[prefabLoader] Manifest load failed:", e);
  }

  // ---------------------------------------------------------------------
  // User drop-folder pass — public/prefabs/user/*.glb
  //
  // The Rust `list_user_prefabs` command scans the folder and returns
  // the bare filenames. We synthesize a manifest entry per file and
  // funnel through the same `registerGlbPrefab` path the static manifest
  // uses, so behaviour (auto-scale, re-floor, material clone, cache) is
  // identical. Dedup via `loadedCache` keeps the Refresh button cheap.
  //
  // Loud-over-silent: a failed invoke (running under plain Vite or the
  // command not registered yet) logs WARN and continues — built-in and
  // static manifest prefabs are unaffected.
  // ---------------------------------------------------------------------
  try {
    const userFiles = (await invoke("list_user_prefabs")) as string[];
    for (const filename of userFiles) {
      const id = `user-${filename.replace(/\.glb$/i, "")}`;
      if (loadedCache.has(id)) {
        // Already loaded on a prior pass — Refresh becomes a no-op for
        // files that haven't changed since last scan.
        continue;
      }
      try {
        await registerGlbPrefab({
          id,
          displayName: prettifyFilename(filename),
          category: "user",
          glbPath: `user/${filename}`,
          defaultScale: { x: 1, y: 1, z: 1 },
        });
        loaded++;
      } catch (e) {
        console.warn(
          `[prefabLoader] Failed to load user prefab ${filename}:`,
          e,
        );
        failed.push(id);
      }
    }
  } catch (e) {
    console.warn(
      "[prefabLoader] list_user_prefabs failed (Tauri command missing or running under plain Vite?):",
      e,
    );
  }

  return { loaded, failed, builtins };
}

/**
 * Turn a bare filename into a human-readable display name.
 *
 *   concrete_bunker.glb       → "Concrete Bunker"
 *   ruined-skyscraper-a.glb   → "Ruined Skyscraper A"
 *   FooBar.glb                → "FooBar"   (preserves intra-word case)
 *
 * Intentionally simple: strip `.glb`, replace runs of `-`/`_` with a
 * single space, then title-case the leading letter of every word. We
 * don't touch interior letters so existing CamelCase survives.
 */
function prettifyFilename(name: string): string {
  return name
    .replace(/\.glb$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function registerGlbPrefab(entry: ManifestEntry): Promise<void> {
  if (!entry.glbPath) return;
  const path = `/prefabs/${entry.glbPath}`;
  const loader = await getLoader();
  const gltf = await loader.loadAsync(path);
  const sourceRoot = gltf.scene;

  // Auto-scale: normalize so the model's max bbox dimension is ~4m.
  // Many free model kits ship at wildly different scales (1 unit = 1cm
  // vs 1m vs 1km). Normalizing here keeps prop-class assets within a
  // sane factor of one another regardless of source.
  const box = new THREE.Box3().setFromObject(sourceRoot);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const autoScale = maxDim > 0 ? 4 / maxDim : 1;
  sourceRoot.scale.setScalar(autoScale);

  // Re-floor: shift down so the model's bottom-most vertex sits at y=0.
  // Without this, modelled origins are inconsistent across kits (some
  // are centered, some at floor, some at ceiling) and props float or
  // sink into the terrain on placement.
  sourceRoot.updateMatrixWorld(true);
  const flooredBox = new THREE.Box3().setFromObject(sourceRoot);
  sourceRoot.position.y -= flooredBox.min.y;

  loadedCache.set(entry.id, sourceRoot);

  prefabRegistry.register({
    id: entry.id,
    name: entry.displayName,
    build: () => {
      // Object3D.clone(true) deep-clones the subtree; meshes share their
      // BufferGeometry with the source (cheap memory-wise).
      const inst = sourceRoot.clone(true);
      // Clone materials per-instance so future per-prefab tinting or
      // selection-highlight overrides don't leak across siblings.
      inst.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material) {
          if (Array.isArray(o.material)) {
            o.material = o.material.map((m) => m.clone());
          } else {
            o.material = o.material.clone();
          }
        }
      });
      // Wrap in a Group so PrefabRenderer's `position.set(...)` writes
      // to the wrapper — the model's auto-floor offset on `inst` is
      // preserved as a local transform. Same pattern as the built-in cube.
      const group = new THREE.Group();
      group.add(inst);
      return group;
    },
    defaultScale: entry.defaultScale,
  });
}
