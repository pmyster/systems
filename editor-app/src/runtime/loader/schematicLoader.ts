/**
 * schematicLoader — Phase 1 Week 1B
 *
 * Read + Zod-parse one or more unit Schematic JSON files for the runtime.
 *
 * Mirrors the editor's `src/file-ops/open.ts` flow (which opens ONE file at
 * a time for the Unit editor). The runtime difference: a match needs an
 * arbitrary SET of unit types (the player picks "I want a tank, a scout, and
 * a flyer in this battle"), so we accept multi-select dialogs and tolerate
 * per-file failures — one broken JSON shouldn't kill the whole match-load.
 *
 * Validation strategy:
 *   - Parse with UnitSchematicSchema (the same gate the Unit editor uses)
 *   - On failure: log WARN with the path + issues, skip the file
 *   - On success: add to result; vulnerability gets defaulted by the editor's
 *     load path normally, but for the runtime we expose the parsed shape as-is
 *     because vulnerability isn't read by Week 1B (no combat yet)
 *
 * Loud-over-silent: every dropped file emits a console.warn carrying the
 * path + the Zod issues, so authoring problems surface during dev.
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { UnitSchematicSchema } from "../../lib/zod-schemas";
import type { UnitSchematic } from "../../types/unit";

export interface LoadedSchematic {
  /** Absolute path of the JSON file. */
  readonly path: string;
  /**
   * Parsed unit. NOTE: the Zod schema marks `vulnerability` as optional so
   * pre-vulnerability files still parse; the `UnitSchematic` TS type marks
   * it required. We cast at the boundary because the runtime's Week 1B
   * surface doesn't touch vulnerability — when combat lands (Week 3) we'll
   * port the defaulting logic from `file-ops/open.ts` here.
   */
  readonly unit: UnitSchematic;
}

/**
 * Show a multi-select JSON file picker, then load + parse each selection.
 * Returns the successfully-loaded schematics; failures are logged but do
 * NOT abort the batch.
 */
export async function pickAndLoadSchematics(): Promise<LoadedSchematic[]> {
  const picked = await openDialog({
    multiple: true,
    directory: false,
    title: "Pick unit Schematic JSON files",
    filters: [{ name: "Unit Schematic JSON", extensions: ["json"] }],
  });
  if (picked === null || picked === undefined) return [];
  // Normalize: Tauri 2.x returns string[] for multiple:true, but the typing
  // permits string | string[] in some plugin versions. Defensive cast.
  const paths: string[] = Array.isArray(picked)
    ? picked.filter((p): p is string => typeof p === "string")
    : typeof picked === "string"
      ? [picked]
      : [];
  return await loadSchematicsByPaths(paths);
}

/**
 * Load + parse a known list of paths. Exposed so the React shell can wire
 * up batched loads from any source (drag-drop, Recent Units, etc.) without
 * going through the dialog.
 */
export async function loadSchematicsByPaths(
  paths: readonly string[],
): Promise<LoadedSchematic[]> {
  const result: LoadedSchematic[] = [];
  for (const path of paths) {
    try {
      // Same Rust command the Unit editor uses (`src/file-ops/open.ts`) —
      // bypasses the fs-plugin scope because dialog-picked paths can live
      // anywhere on disk.
      const text = await invoke<string>("read_unit_file", { path });
      const parsed: unknown = JSON.parse(text);
      const validated = UnitSchematicSchema.safeParse(parsed);
      if (!validated.success) {
        // Loud-over-silent: surface every dropped file with the Zod issues
        // so authoring bugs are obvious in the dev console.
        console.warn(
          `[schematicLoader] schema validation failed for ${path}:`,
          validated.error.issues,
        );
        continue;
      }
      // The cast is the same one used in `file-ops/open.ts`: vulnerability
      // is optional on the wire schema but required on the TS type, and
      // Week 1B doesn't read it. Week 3 will port the defaulting helper.
      result.push({ path, unit: validated.data as unknown as UnitSchematic });
    } catch (e) {
      console.warn(`[schematicLoader] failed to load ${path}:`, e);
    }
  }
  return result;
}
