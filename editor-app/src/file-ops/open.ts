/**
 * File → Open via Tauri native dialog.
 *
 * Behavior contract (docs/editor-app-tauri-brief.md → "File operations"):
 *   - Native open-file dialog filtered to .json.
 *   - Reads file via the custom Rust `read_unit_file` command (no
 *     browser FileReader, no fs plugin). The Rust command uses
 *     `std::fs::read_to_string` directly, which bypasses the fs
 *     plugin's scope — necessary because the dialog can return paths
 *     anywhere on disk and Tauri 2 does NOT auto-grant scope to
 *     dialog-picked paths.
 *   - Parses JSON, validates against UnitSchematicSchema (Zod).
 *   - Validation errors block load and surface to the caller. We
 *     throw an OpenValidationError carrying the issues so the App
 *     shell can display them.
 *   - Voxel data, if present on the unit, is deserialized into the
 *     editor's live VoxelMap shape via extractVoxelsFromUnit.
 *
 * The function signature returns `null` only when the user cancels the
 * dialog. Everything else (read failure, parse failure, validation
 * failure) throws — the caller decides how to surface.
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { ZodIssue } from "zod";

import { UnitSchematicSchema } from "../lib/zod-schemas";
import { extractVoxelsFromUnit } from "../state/voxel-sync";
import type { UnitSchematic } from "../types/unit";
import type { VoxelMap } from "../types/voxel";

export interface OpenedUnit {
  readonly unit: UnitSchematic;
  readonly voxels: VoxelMap;
  readonly path: string;
}

/**
 * Thrown when a loaded file parses as JSON but fails schema validation.
 * Carries the full list of Zod issues so the UI can display them all.
 */
export class OpenValidationError extends Error {
  readonly issues: readonly ZodIssue[];
  readonly path: string;
  constructor(path: string, issues: readonly ZodIssue[]) {
    super(`Unit at ${path} failed schema validation`);
    this.name = "OpenValidationError";
    this.path = path;
    this.issues = issues;
  }
}

/**
 * Thrown when the chosen file isn't valid JSON.
 */
export class OpenParseError extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    super(
      `Unit at ${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "OpenParseError";
    this.path = path;
  }
}

/**
 * Prompt the user for a unit JSON file and load it.
 *
 * Returns `null` if the user cancels the dialog. Throws
 * `OpenParseError` or `OpenValidationError` on bad content; lets any
 * I/O error from the `read_unit_file` Rust command propagate (it
 * surfaces as a plain Error from `invoke()`).
 */
export async function openUnit(): Promise<OpenedUnit | null> {
  const picked = await openDialog({
    title: "Open Unit Schematic",
    multiple: false,
    directory: false,
    filters: [{ name: "Unit Schematic JSON", extensions: ["json"] }],
  });

  if (picked === null || picked === undefined) return null;
  // multiple:false returns a string (Tauri 2.x). Defensive: handle the
  // array shape too in case the plugin's typing widens.
  const path: string =
    typeof picked === "string"
      ? picked
      : Array.isArray(picked) && typeof picked[0] === "string"
        ? (picked[0] as string)
        : "";
  if (!path) return null;

  const text = await invoke<string>("read_unit_file", { path });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new OpenParseError(path, cause);
  }

  const result = UnitSchematicSchema.safeParse(parsed);
  if (!result.success) {
    throw new OpenValidationError(path, result.error.issues);
  }

  // The Zod-inferred shape is structurally compatible with
  // UnitSchematic (the type-level sync checks in zod-schemas.ts enforce
  // this at compile time). One cast at the IO boundary is the price.
  const unit = result.data as UnitSchematic;
  let voxels: VoxelMap;
  try {
    voxels = extractVoxelsFromUnit(unit);
  } catch (cause) {
    throw new OpenParseError(path, cause);
  }

  return { unit, voxels, path };
}
