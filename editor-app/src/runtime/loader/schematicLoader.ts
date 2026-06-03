/**
 * schematicLoader — Phase 1 Week 1B (Week 3 hardening pass)
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
 * Loud-over-silent (CLAUDE.md rule #1): every dropped file emits both a
 * console.warn AND a structured LoadDiagnostics entry (when a collector
 * is provided) so authoring problems surface in the HUD's "Load
 * warnings" chip — NOT only in the dev console where most owners never
 * look.
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { UnitSchematicSchema } from "../../lib/zod-schemas";
import type { UnitSchematic } from "../../types/unit";
import type { LoadDiagnostics } from "./LoadDiagnostics";

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
 * NOT abort the batch. Per-file failures push to the optional `diagnostics`
 * collector so they surface in the HUD.
 */
export async function pickAndLoadSchematics(
  diagnostics?: LoadDiagnostics,
): Promise<LoadedSchematic[]> {
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
  return await loadSchematicsByPaths(paths, diagnostics);
}

/**
 * Load + parse a known list of paths. Exposed so the React shell can wire
 * up batched loads from any source (drag-drop, Recent Units, etc.) without
 * going through the dialog.
 *
 * Per-file failures push a structured entry into the optional
 * `diagnostics` collector. Per CLAUDE.md rule #1 the failure surfaces in
 * BOTH places — console (existing path) AND the collector (new HUD path).
 */
export async function loadSchematicsByPaths(
  paths: readonly string[],
  diagnostics?: LoadDiagnostics,
): Promise<LoadedSchematic[]> {
  const result: LoadedSchematic[] = [];
  for (const path of paths) {
    try {
      // Same Rust command the Unit editor uses (`src/file-ops/open.ts`) —
      // bypasses the fs-plugin scope because dialog-picked paths can live
      // anywhere on disk.
      const text = await invoke<string>("read_unit_file", { path });
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (jsonErr) {
        diagnostics?.addFromError(
          "schematicLoader",
          `JSON parse failed for ${path}`,
          jsonErr,
        );
        // Still log to console even when no collector is wired (e.g. tests).
        if (!diagnostics) {
          console.warn(`[schematicLoader] JSON parse failed for ${path}:`, jsonErr);
        }
        continue;
      }
      const validated = UnitSchematicSchema.safeParse(parsed);
      if (!validated.success) {
        // Loud-over-silent: surface every dropped file with the Zod issues
        // so authoring bugs are obvious in the dev console AND the HUD.
        const issueSummary = validated.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ");
        diagnostics?.add({
          source: "schematicLoader",
          message: `schema validation failed for ${path}: ${issueSummary}${validated.error.issues.length > 3 ? ` (+${validated.error.issues.length - 3} more)` : ""}`,
          detail: validated.error.issues,
        });
        if (!diagnostics) {
          console.warn(
            `[schematicLoader] schema validation failed for ${path}:`,
            validated.error.issues,
          );
        }
        continue;
      }
      // The cast is the same one used in `file-ops/open.ts`: vulnerability
      // is optional on the wire schema but required on the TS type, and
      // Week 1B doesn't read it. Week 3 will port the defaulting helper.
      result.push({ path, unit: validated.data as unknown as UnitSchematic });
    } catch (e) {
      diagnostics?.addFromError(
        "schematicLoader",
        `failed to load ${path}`,
        e,
      );
      if (!diagnostics) {
        console.warn(`[schematicLoader] failed to load ${path}:`, e);
      }
    }
  }
  return result;
}
