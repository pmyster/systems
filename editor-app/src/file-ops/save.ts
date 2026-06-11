/**
 * File → Save / Save As via Tauri native dialog + a custom Rust write
 * command.
 *
 * Behavior contract (docs/editor-app-tauri-brief.md → "File operations"):
 *   - On Save: if a path is known, validate then write canonical JSON.
 *   - On Save As: always open a save-file dialog first.
 *   - Validation runs every save. Invalid content blocks the write
 *     and the caller is expected to surface the issues.
 *   - Canonical JSON: stable key order (we rely on JSON.stringify
 *     iterating in insertion order, which matches how the editor
 *     constructs the unit object), 2-space indent, trailing newline,
 *     UTF-8.
 *
 * The write goes through the Rust `write_unit_file` command rather than
 * `@tauri-apps/plugin-fs`. That bypasses the fs plugin's scope, which
 * is necessary because dialog-picked save targets can land anywhere on
 * disk and Tauri 2 does NOT auto-grant scope for them.
 *
 * `saveUnit` returns the final path on success, or null if the user
 * cancels Save As. Throws SaveValidationError on schema failure.
 */

import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { ZodIssue } from "zod";

import { UnitSchematicSchema } from "../lib/zod-schemas";
import type { UnitSchematic } from "../types/unit";

/**
 * Thrown when the unit fails schema validation before a write.
 */
export class SaveValidationError extends Error {
  readonly issues: readonly ZodIssue[];
  constructor(issues: readonly ZodIssue[]) {
    super("Unit failed schema validation; save aborted");
    this.name = "SaveValidationError";
    this.issues = issues;
  }
}

/**
 * Serialize a unit to canonical JSON.
 *
 * 2-space indent + trailing newline per the brief. Object-key ordering
 * follows the unit's own property order at construction time — the
 * editor builds units with field order matching schemas/unit.schema.json
 * so the output is stable.
 */
export function toCanonicalJson(unit: UnitSchematic): string {
  return JSON.stringify(unit, null, 2) + "\n";
}

/**
 * Save a unit to the given path, or prompt for one. Returns the final
 * path on success, or `null` if the user cancels Save As.
 *
 * @param unit  The unit to save.
 * @param path  Existing path (if known). If undefined, prompts the
 *              user via Save As.
 */
export async function saveUnit(
  unit: UnitSchematic,
  path?: string | null,
): Promise<string | null> {
  // Validate FIRST — never write invalid content.
  const result = UnitSchematicSchema.safeParse(unit);
  if (!result.success) {
    throw new SaveValidationError(result.error.issues);
  }

  let targetPath: string | null = path ?? null;
  if (!targetPath) {
    const suggested = `${unit.id || "unit"}.json`;
    targetPath = await saveDialog({
      title: "Save Unit Schematic",
      defaultPath: suggested,
      filters: [{ name: "Unit Schematic JSON", extensions: ["json"] }],
    });
    if (!targetPath) return null;
  }

  const text = toCanonicalJson(unit);
  await invoke("write_unit_file", { path: targetPath, contents: text });
  return targetPath;
}

/**
 * Always prompt for a path. Convenience wrapper around saveUnit.
 */
export async function saveUnitAs(unit: UnitSchematic): Promise<string | null> {
  return saveUnit(unit, null);
}
