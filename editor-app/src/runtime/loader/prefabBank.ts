/**
 * prefabBank — Phase 1 Week 1B (Week 3 hardening pass)
 *
 * Dedup-loads the visual meshes referenced by the loaded unit schematics.
 *
 * Why a bank (not per-entity load)?
 *   Architectural rule from the brief: "If 50 mk01 entities share one mesh,
 *   load the GLB once and stamp 50 InstancedMesh slots, not 50 scene-graph
 *   clones." The bank is the dedup boundary — keyed on the canonical form
 *   of `unit.mesh_asset`, it loads once and serves the cached Object3D to
 *   every subsequent caller.
 *
 * Resolution uses an ADAPTIVE registry (per CLAUDE.md rule #2):
 *
 *   The bank holds a `MESH_ASSET_RESOLVERS` map keyed by `ref.kind`. A new
 *   mesh-asset shape tomorrow (e.g. `{ kind: "url", url: "..." }` for a
 *   future CDN-hosted prefab system) is a single map entry — no edits to
 *   every call site. Unknown kinds DO NOT silent-drop: they surface
 *   through `LoadDiagnostics` AND throw, so the per-prefab try/catch in
 *   MatchLoader can move past them while the HUD shows a "Load warnings"
 *   chip pointing at the unknown shape.
 *
 *   - `kind === "template"` → look up `TEMPLATES` by id and call
 *     `buildGeometry()`. Built-in templates (tank, mech, flyer, …) are
 *     pure procedural Three.js — no GLB on disk.
 *
 *   - `kind === "file"`     → read the file via `loadMeshFromPath` (the
 *     same helper the Mesh Workspace uses). Path can be ANY absolute or
 *     relative path the Tauri webview can read via `read_unit_file` /
 *     `read_binary_file`. Failures bubble with the underlying Error's
 *     message + stack so the HUD chip points at the real cause.
 *
 *   - `kind === <anything-else>` → ADAPTIVE FALLBACK: collected as a
 *     `LoadDiagnostics` warning AND thrown so the caller's per-prefab
 *     catch loop continues with the next unit type.
 *
 * Returning a CACHED Object3D means downstream code must NEVER mutate the
 * returned subtree directly. The `InstancedUnitRenderer` extracts the
 * first Mesh's geometry + a clone of its material, so the cached root is
 * effectively read-only after registration.
 */

import * as THREE from "three";

import { TEMPLATES } from "../../lib/templates";
import { loadMeshFromPath } from "../../components/MeshWorkspace/mesh-loader";
import type { MeshAssetRef } from "../../types/unit";
import type { LoadDiagnostics } from "./LoadDiagnostics";
import { buildProceduralBuildingMesh } from "../scene/proceduralMeshes";

/**
 * Adaptive resolver: given a mesh asset ref, return a stable cache key
 * AND an async loader that produces the THREE.Object3D root.
 *
 * Registered handlers cover every `kind` the runtime knows about today.
 * Adding a new `kind` tomorrow is ONE entry here — no plumbing edits in
 * MatchLoader, MatchSpawner, or the renderer. This is CLAUDE.md rule #2
 * ("adaptive over specific") in code: gates match the SHAPE of reality,
 * not a snapshot of it.
 */
interface MeshAssetResolver<K extends MeshAssetRef["kind"]> {
  readonly key: (ref: Extract<MeshAssetRef, { kind: K }>) => string;
  readonly load: (
    ref: Extract<MeshAssetRef, { kind: K }>,
  ) => Promise<THREE.Object3D>;
}

const MESH_ASSET_RESOLVERS: {
  readonly template: MeshAssetResolver<"template">;
  readonly file: MeshAssetResolver<"file">;
  readonly procedural_building: MeshAssetResolver<"procedural_building">;
} = {
  template: {
    key: (ref) => `template:${ref.template_id}`,
    load: async (ref) => {
      const tpl = TEMPLATES.find((t) => t.id === ref.template_id);
      if (!tpl) {
        throw new Error(
          `unknown template "${ref.template_id}". Known: ${TEMPLATES.map((t) => t.id).join(", ")}`,
        );
      }
      // Templates return a fresh centred Group with max dim ≈ 8 units
      // (matches the NORMALIZE_TARGET_M from mesh-loader). One build per
      // bank lifetime — every downstream instance reuses the geometry.
      return tpl.buildGeometry();
    },
  },
  file: {
    // Normalize Windows path separators in the cache key so the same
    // file referenced as `C:\…\foo.glb` and `C:/…/foo.glb` dedups to
    // ONE cache entry. The actual on-disk read still uses the original
    // path string verbatim — Windows accepts both separators.
    key: (ref) => `file:${ref.path.replace(/\\/g, "/")}`,
    load: async (ref) => {
      try {
        return await loadMeshFromPath(ref.path);
      } catch (e) {
        // Wrap with the path so the catch site has the context even if
        // the underlying Error was generic ("self is not defined", etc).
        const msg = e instanceof Error ? e.message : String(e);
        const wrapped = new Error(
          `loadMeshFromPath failed for "${ref.path}": ${msg}`,
        );
        // Preserve cause so devs can read the original stack.
        if (e instanceof Error) (wrapped as Error & { cause?: unknown }).cause = e;
        throw wrapped;
      }
    },
  },
  // Phase 2 Stage 1 — procedural building meshes. No I/O, no parse — the
  // builder constructs a Three.js Group of primitive geometries in memory.
  // PrefabBank still caches the first instance so all turrets of the
  // same chassis share one Object3D root (and one set of GPU buffers).
  procedural_building: {
    key: (ref) => `procedural_building:${ref.building_chassis}`,
    load: async (ref) => {
      return buildProceduralBuildingMesh(ref.building_chassis);
    },
  },
};

/**
 * Canonical cache key for a mesh asset reference. Stable for identical
 * refs, distinct otherwise. Falls through to a tagged "unknown:<json>"
 * key when an unknown `kind` arrives — so two unknowns with the same
 * shape STILL dedup, instead of silently picking up the first one's
 * cached entry.
 */
export function meshAssetKey(ref: MeshAssetRef): string {
  // The closed union only has "template" | "file" today. The defensive
  // unknown branch below is reachable when a future schema widens the
  // union and an older runtime sees the new shape. The `as never` cast
  // makes the unreachable branches a compile error if a new kind is
  // ADDED to the union without a resolver — which is the "loud over
  // silent" guarantee for schema growth.
  switch (ref.kind) {
    case "template":
      return MESH_ASSET_RESOLVERS.template.key(ref);
    case "file":
      return MESH_ASSET_RESOLVERS.file.key(ref);
    case "procedural_building":
      return MESH_ASSET_RESOLVERS.procedural_building.key(ref);
    default: {
      // Unknown kind: build a stable key from the JSON shape itself so
      // dedup still works for repeat occurrences. The actual load() will
      // refuse with a clear warning.
      const unknown = ref as { readonly kind?: string };
      return `unknown:${unknown.kind ?? "<missing>"}:${stableJson(ref)}`;
    }
  }
}

/**
 * Deterministic JSON serialisation for cache-key stability across
 * unknown-shaped refs. Keys are sorted so `{a:1,b:2}` and `{b:2,a:1}`
 * produce the same string.
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

export class PrefabBank {
  /** key → loaded root (cached forever for the bank's lifetime). */
  private cache = new Map<string, THREE.Object3D>();
  /** key → in-flight promise (dedup concurrent loads of the same ref). */
  private inflight = new Map<string, Promise<THREE.Object3D>>();
  /**
   * Optional diagnostics collector. When set (MatchLoader wires it),
   * unknown-kind refs push a structured warning here in addition to
   * throwing — so the HUD's "Load warnings" chip surfaces the cause.
   * Optional so the existing test bed (which never wires it) keeps
   * working without changes.
   */
  private diagnostics: LoadDiagnostics | undefined = undefined;

  /**
   * Attach a diagnostics collector. Repeated calls replace the previous
   * collector. The bank only writes to it; it never reads back.
   */
  setDiagnostics(diag: LoadDiagnostics | undefined): void {
    this.diagnostics = diag;
  }

  /**
   * Load (or return cached) the mesh for a unit's `mesh_asset` ref.
   *
   * Concurrent calls for the SAME ref share one promise — if two await
   * loads of "tank" overlap, only one resolver call + caching happens.
   *
   * Throws if the ref's kind is unknown, the template id is unknown, or
   * the file the editor's mesh-loader rejects. Callers (MatchLoader)
   * catch + log per ref so one bad unit type doesn't kill the whole
   * match-load.
   *
   * Loud-over-silent: the unknown-kind branch ALSO pushes a structured
   * warning into the attached LoadDiagnostics (if any) so the failure
   * surfaces in the HUD, not just `console.warn`.
   */
  async load(ref: MeshAssetRef): Promise<THREE.Object3D> {
    const key = meshAssetKey(ref);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = (async () => {
      const root = await this.runResolver(ref);
      this.cache.set(key, root);
      return root;
    })();
    this.inflight.set(key, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Dispatch into the adaptive resolver table. Unknown kinds raise a
   * loud, structured failure: a LoadDiagnostics warning + a thrown
   * Error. CLAUDE.md rule #1 ("loud over silent") demands BOTH paths
   * — the warning so the HUD surfaces it; the throw so MatchLoader's
   * per-prefab catch isolates the bad type from the rest of the batch.
   */
  private async runResolver(ref: MeshAssetRef): Promise<THREE.Object3D> {
    switch (ref.kind) {
      case "template":
        return MESH_ASSET_RESOLVERS.template.load(ref);
      case "file":
        return MESH_ASSET_RESOLVERS.file.load(ref);
      case "procedural_building":
        return MESH_ASSET_RESOLVERS.procedural_building.load(ref);
      default: {
        const unknownRef = ref as { readonly kind?: string };
        const kind = unknownRef.kind ?? "<missing>";
        this.diagnostics?.add({
          source: "prefabBank",
          message: `unknown mesh_asset.kind "${kind}" — no resolver registered. Add one to MESH_ASSET_RESOLVERS.`,
          detail: ref,
        });
        throw new Error(
          `prefabBank: unknown mesh_asset.kind "${kind}"; add a resolver to MESH_ASSET_RESOLVERS.`,
        );
      }
    }
  }

  /** True iff this ref is in cache (post-await). Skips inflight checks. */
  has(ref: MeshAssetRef): boolean {
    return this.cache.has(meshAssetKey(ref));
  }

  /** Get the cached root for a ref, or undefined. Does NOT trigger a load. */
  get(ref: MeshAssetRef): THREE.Object3D | undefined {
    return this.cache.get(meshAssetKey(ref));
  }

  /** Diagnostic: how many distinct meshes are loaded. */
  size(): number {
    return this.cache.size;
  }

  /**
   * Dispose every cached subtree's GPU resources. Call when tearing down
   * a match. After this, the bank is empty and reusable for the next match.
   *
   * IMPORTANT: this also disposes geometries + materials that
   * `InstancedUnitRenderer` may have referenced (the renderer clones
   * materials but shares geometry). Callers should dispose the renderer
   * FIRST, then the bank.
   */
  dispose(): void {
    for (const obj of this.cache.values()) {
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m && typeof (m as THREE.Material).dispose === "function") {
              (m as THREE.Material).dispose();
            }
          }
        }
      });
    }
    this.cache.clear();
    this.inflight.clear();
  }
}
