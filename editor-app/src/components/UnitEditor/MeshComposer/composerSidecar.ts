/**
 * composerSidecar — Mesh Composer sidecar I/O + Zod schema.
 *
 * The Mesh Composer is a NON-DESTRUCTIVE editor: the owner places sub-meshes
 * with TransformControls but the original `.glb` produced by Hunyuan3D is
 * never rewritten. Per-sub-mesh translate/rotate/scale/visibility overrides
 * are persisted to a sidecar JSON file living next to the GLB:
 *
 *   units/tank/meshes/turret.glb
 *   units/tank/meshes/turret.composer.json   ← sidecar
 *
 * Both the runtime (MatchLoader → prefabBank → applyComposerOverrides) and
 * the editor (MeshComposer panel) read this file. Either side may write it
 * (editor only at present; future tooling could pre-bake from a CLI).
 *
 * SHAPE — keep this absolutely stable; the runtime depends on it.
 *
 *   {
 *     "version": 1,
 *     "unit_id": "ihor-horholiuk-turret",
 *     "submesh_overrides": {
 *       "<sub-mesh node name>": {
 *         "position":      [x, y, z],
 *         "rotation_quat": [x, y, z, w],
 *         "scale":         [sx, sy, sz],
 *         "visible":       true
 *       }
 *     }
 *   }
 *
 * Loud-over-silent (CLAUDE.md rule #1):
 *   - Malformed JSON → throw with the parse error.
 *   - Schema-invalid JSON → throw with the Zod path of the first issue.
 *   - Sidecar references a sub-mesh name not present in the GLB →
 *     `applyComposerOverrides` warns with the missing name + available names
 *     (handled in `composerOverrides.ts`, not here).
 */

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schema.
// ---------------------------------------------------------------------------

/** Single-axis triple. Reused for position + scale. */
const Vec3Schema = z
  .tuple([z.number(), z.number(), z.number()])
  .describe("Three-element tuple [x, y, z].");

/** Quaternion: [x, y, z, w]. Three.js convention. */
const QuatSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .describe("Quaternion [x, y, z, w] (Three.js convention).");

export const SubMeshOverrideSchema = z.object({
  position: Vec3Schema,
  rotation_quat: QuatSchema,
  scale: Vec3Schema,
  visible: z.boolean(),
});

export const ComposerSidecarSchema = z.object({
  version: z.literal(1),
  unit_id: z.string().min(1),
  submesh_overrides: z.record(z.string(), SubMeshOverrideSchema),
});

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type SubMeshOverride = z.infer<typeof SubMeshOverrideSchema>;
export type ComposerSidecar = z.infer<typeof ComposerSidecarSchema>;

// ---------------------------------------------------------------------------
// Path helpers.
// ---------------------------------------------------------------------------

/**
 * Given an absolute GLB / GLTF path, return the sidecar JSON path that lives
 * next to it.
 *
 *   /foo/bar/turret.glb         → /foo/bar/turret.composer.json
 *   C:\dev\…\turret.gltf        → C:\dev\…\turret.composer.json
 *   C:\dev\…\no-extension       → C:\dev\…\no-extension.composer.json
 *
 * The extension swap is conservative: only `.glb` and `.gltf` get replaced.
 * Anything else gets `.composer.json` appended so we never silently overwrite
 * an unexpected file.
 */
export function sidecarPathFor(meshPath: string): string {
  const lower = meshPath.toLowerCase();
  if (lower.endsWith(".glb")) return meshPath.slice(0, -4) + ".composer.json";
  if (lower.endsWith(".gltf")) return meshPath.slice(0, -5) + ".composer.json";
  return meshPath + ".composer.json";
}

// ---------------------------------------------------------------------------
// I/O.
// ---------------------------------------------------------------------------

/**
 * Read + validate a sidecar at `path`. Returns the parsed sidecar on success.
 * Returns `null` when the file does not exist (the common, non-error case).
 * Throws on any other failure:
 *   - read error (permission, IO) → wrapped Error with the underlying message
 *   - JSON parse error            → wrapped Error with the position
 *   - schema mismatch             → wrapped Error with the Zod issues
 *
 * The runtime side calls this in a try/catch and downgrades the error to a
 * structured `LoadDiagnostics` entry so one bad sidecar doesn't kill the
 * whole match-load; the editor side surfaces it in an in-panel error banner.
 */
export async function readComposerSidecar(
  path: string,
): Promise<ComposerSidecar | null> {
  // The dedicated Rust command returns `null` for missing files so we can
  // distinguish "not present" (fine — render as-is) from "present but
  // broken" (loud — surface to the user). We deliberately do NOT swallow
  // any other read error here.
  let raw: string | null;
  try {
    raw = await invoke<string | null>("read_composer_sidecar", { path });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[composerSidecar] read failed for "${path}": ${msg}`);
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `[composerSidecar] JSON parse failed for "${path}": ${msg}`,
    );
  }

  const validated = ComposerSidecarSchema.safeParse(parsed);
  if (!validated.success) {
    const summary = validated.error.issues
      .slice(0, 3)
      .map(
        (i) =>
          `${i.path.join(".") || "<root>"}: ${i.message}`,
      )
      .join("; ");
    const more =
      validated.error.issues.length > 3
        ? ` (+${validated.error.issues.length - 3} more)`
        : "";
    throw new Error(
      `[composerSidecar] schema invalid for "${path}": ${summary}${more}`,
    );
  }
  return validated.data;
}

/**
 * Write a sidecar to disk. The parent directory must already exist (which
 * it always does in practice — the GLB sits there). The JSON is pretty-
 * printed so diff tools work nicely.
 */
export async function writeComposerSidecar(
  path: string,
  sidecar: ComposerSidecar,
): Promise<void> {
  // Last-chance validation — we never want to write a malformed sidecar
  // even if the in-memory object somehow drifted. Throws on mismatch.
  const validated = ComposerSidecarSchema.parse(sidecar);
  const text = JSON.stringify(validated, null, 2) + "\n";
  await invoke("write_unit_file", { path, contents: text });
}

/**
 * Delete the sidecar at `path`. Used by the editor's "Reset" button. The
 * Rust side returns ok-without-error if the file is already absent (the
 * common case when the user resets a unit that never had a sidecar) so the
 * caller doesn't need a "does it exist" round-trip.
 */
export async function deleteComposerSidecar(path: string): Promise<void> {
  await invoke("delete_composer_sidecar", { path });
}

// ---------------------------------------------------------------------------
// Construction helpers.
// ---------------------------------------------------------------------------

/**
 * Build an empty sidecar for a given unit id. The editor starts from this and
 * accumulates overrides as the user drags the gizmo.
 */
export function emptySidecar(unitId: string): ComposerSidecar {
  return {
    version: 1,
    unit_id: unitId,
    submesh_overrides: {},
  };
}
