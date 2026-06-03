/**
 * composerOverrides — runtime-side application of Mesh Composer sidecars.
 *
 * Sits between `prefabBank.load(ref)` and `InstancedUnitRenderer.register`.
 * Given a freshly loaded prefab `THREE.Object3D` root and the corresponding
 * `mesh_asset.path`, look up the sidecar JSON next to the GLB and — if
 * present — mutate the sub-mesh transforms in place BEFORE the renderer
 * captures their rest-pose `localPosition/localQuaternion/localScale`.
 *
 * Why mutate-in-place (vs. clone-and-mutate)?
 *   The PrefabBank caches one Object3D per `mesh_asset` ref. Every entity of
 *   that unit type shares the cached root. Mutating in place means every
 *   entity sees the composed transforms — which is exactly the contract
 *   the owner wants ("save this layout, every spawn uses it").
 *
 * Loud-over-silent (CLAUDE.md rule #1):
 *   - No sidecar → return false, no logs. (The common case.)
 *   - Sidecar present but read/parse/schema fails → THROW with the path;
 *     MatchLoader catches and pushes a `LoadDiagnostics` entry so the HUD
 *     surfaces it.
 *   - Sidecar references a sub-mesh name not in the GLB → WARN with the
 *     missing name + the list of available names, AND push a structured
 *     diagnostic via the optional callback. The valid overrides still
 *     apply — partial success is better than all-or-nothing.
 *   - Sub-mesh marked `visible: false` → set `node.visible = false`. The
 *     renderer's traversal still discovers it (so the catch-all bucket is
 *     populated) but it won't draw.
 *
 * Adaptive over specific (CLAUDE.md rule #2):
 *   The applier iterates the GLB's sub-meshes by name lookup, not by a
 *   hardcoded list. Any future sub-mesh shape (group nodes, light nodes,
 *   helpers) automatically participates as long as it carries a `.name`.
 *   New override fields are a one-line addition to the Zod schema +
 *   applier — no plumbing changes elsewhere.
 *
 * Stateless: this module owns no caches. The caller (MatchLoader) is
 * responsible for sequencing the call before `register`. Idempotent in the
 * sense that re-running with the same sidecar produces the same final
 * transform (we WRITE absolute values from the sidecar, we don't ACCUMULATE
 * deltas).
 */

import * as THREE from "three";

import {
  readComposerSidecar,
  sidecarPathFor,
  type ComposerSidecar,
  type SubMeshOverride,
} from "../../components/UnitEditor/MeshComposer/composerSidecar";

// ---------------------------------------------------------------------------
// Diagnostics shape — kept minimal so tests can stub it without dragging in
// the full LoadDiagnostics class. MatchLoader passes its real collector;
// tests pass an array-push closure.
// ---------------------------------------------------------------------------

export interface ComposerOverrideDiagnostic {
  readonly source: "composerOverrides";
  readonly message: string;
  readonly detail?: unknown;
}

export type DiagnosticSink = (d: ComposerOverrideDiagnostic) => void;

// ---------------------------------------------------------------------------
// Pure applier — exposed for tests that want to skip the disk I/O step.
// ---------------------------------------------------------------------------

/**
 * Apply a pre-loaded sidecar to a pre-loaded prefab root. Mutates `root` in
 * place; returns the set of sub-mesh names actually touched (handy for
 * tests + diagnostic counts).
 *
 * Walks `root` once, collecting every Mesh by `.name`. For each name in
 * `sidecar.submesh_overrides`:
 *   - If the name matches → write position/quaternion/scale/visibility.
 *   - If the name does NOT match → warn + report via `onDiagnostic`,
 *     leaving the GLB unchanged.
 *
 * Names that the GLB has but the sidecar doesn't reference are left at their
 * original rest pose — sidecars are ADDITIVE, not exhaustive.
 */
export function applyComposerOverridesToTree(
  root: THREE.Object3D,
  sidecar: ComposerSidecar,
  onDiagnostic?: DiagnosticSink,
): ReadonlySet<string> {
  // Catalog the GLB's sub-meshes by name. We accept duplicate names (some
  // Hunyuan exports do this) by keeping the FIRST occurrence in the map but
  // also recording a duplicates list for the loud-warn branch — the owner
  // can re-author with unique names if the override has to land on a
  // specific instance.
  const byName = new Map<string, THREE.Mesh>();
  const duplicates: string[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const name = node.name || "<unnamed>";
      if (byName.has(name)) {
        duplicates.push(name);
      } else {
        byName.set(name, node);
      }
    }
  });

  if (duplicates.length > 0) {
    const detail = { duplicates: Array.from(new Set(duplicates)) };
    const msg = `[composerOverrides] duplicate sub-mesh name(s) ${JSON.stringify(detail.duplicates)} — overrides land on the first occurrence only.`;
    // eslint-disable-next-line no-console
    console.warn(msg);
    onDiagnostic?.({ source: "composerOverrides", message: msg, detail });
  }

  const applied = new Set<string>();
  const missing: string[] = [];
  for (const [name, override] of Object.entries(sidecar.submesh_overrides)) {
    const mesh = byName.get(name);
    if (!mesh) {
      missing.push(name);
      continue;
    }
    applyOneOverride(mesh, override);
    applied.add(name);
  }

  if (missing.length > 0) {
    const available = Array.from(byName.keys());
    const msg =
      `[composerOverrides] sidecar references sub-mesh(es) not in GLB: ${JSON.stringify(missing)}. ` +
      `Available names: ${JSON.stringify(available)}. The other overrides applied; these were skipped.`;
    // eslint-disable-next-line no-console
    console.warn(msg);
    onDiagnostic?.({
      source: "composerOverrides",
      message: msg,
      detail: { missing, available },
    });
  }

  return applied;
}

/**
 * Mutate one Mesh node to match one override. Sidecar values are absolute
 * — we overwrite, never accumulate.
 *
 * Visibility: the renderer reads `node.visible` during its initial traversal
 * but does NOT propagate it to the InstancedMesh per-instance. To honor a
 * `visible: false` we therefore have to remove the node from its parent —
 * the renderer's traversal won't see it at all. The original parent is
 * stashed on `userData.__composerHiddenParent` so a future re-apply can
 * restore it if the sidecar is edited.
 */
function applyOneOverride(mesh: THREE.Mesh, o: SubMeshOverride): void {
  mesh.position.set(o.position[0], o.position[1], o.position[2]);
  mesh.quaternion.set(
    o.rotation_quat[0],
    o.rotation_quat[1],
    o.rotation_quat[2],
    o.rotation_quat[3],
  );
  mesh.scale.set(o.scale[0], o.scale[1], o.scale[2]);
  // Refresh matrices so subsequent `getWorld*()` reads (e.g. from the
  // InstancedUnitRenderer's `updateMatrixWorld(true) → decompose`) see the
  // composed transform — not the pre-mutation cache.
  mesh.updateMatrix();

  if (!o.visible) {
    // Hide by detaching from the parent so the renderer's traversal SKIPS
    // it entirely. (Setting `mesh.visible = false` works for the editor's
    // direct renderer but NOT for the InstancedUnitRenderer — that path
    // captures the sub-mesh at register-time regardless of `.visible`.)
    const parent = mesh.parent;
    if (parent) {
      mesh.userData.__composerHiddenParent = parent;
      parent.remove(mesh);
    }
  } else if (mesh.userData.__composerHiddenParent) {
    // Re-attach a previously hidden node. Defensive — covers the case where
    // a sidecar is re-applied to a tree that already had hides applied.
    const parent = mesh.userData.__composerHiddenParent as THREE.Object3D;
    parent.add(mesh);
    delete mesh.userData.__composerHiddenParent;
  }
}

// ---------------------------------------------------------------------------
// Disk-fronted entry — used by MatchLoader.
// ---------------------------------------------------------------------------

/**
 * Load the sidecar for `glbPath` (if any) and apply it to `root`. Returns
 * `true` when overrides were applied, `false` when no sidecar exists.
 *
 * Throws when a sidecar exists but cannot be read/parsed/validated — the
 * caller is expected to catch + diagnose so one bad sidecar doesn't kill the
 * whole match-load.
 *
 * The disk read goes through the dedicated Tauri command (`read_composer_
 * sidecar`) which mirrors the existing safe-read pattern: canonicalize the
 * path → check the file exists → check the extension is `.composer.json` →
 * read. That keeps a stray dialog-picked path from ever pointing at the
 * wrong file.
 */
export async function applyComposerOverrides(
  root: THREE.Object3D,
  glbPath: string,
  onDiagnostic?: DiagnosticSink,
): Promise<boolean> {
  const sidePath = sidecarPathFor(glbPath);
  const sidecar = await readComposerSidecar(sidePath);
  if (sidecar === null) return false;
  // eslint-disable-next-line no-console
  console.info(
    `[composerOverrides] applying ${Object.keys(sidecar.submesh_overrides).length} override(s) from "${sidePath}" to "${glbPath}".`,
  );
  applyComposerOverridesToTree(root, sidecar, onDiagnostic);
  return true;
}
