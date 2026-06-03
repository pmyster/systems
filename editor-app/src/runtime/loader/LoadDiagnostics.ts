/**
 * LoadDiagnostics — Phase 1 Week 3 patch
 *
 * Central collector for every WARN-level event the match-load pipeline
 * emits. The runtime brief and CLAUDE.md "loud over silent" rule require
 * that any dropped / skipped data surfaces somewhere a human looks at —
 * not just `console.warn` (which a dev who hasn't opened the F12 panel
 * never sees).
 *
 * Why a dedicated collector (not just console.warn)?
 *   Previously the chain "1 schematic in → 0 entities out" had every
 *   layer fail SILENTLY-from-the-HUD-perspective: schematicLoader,
 *   prefabBank, MatchSpawner each fired a console.warn the user did not
 *   see, then the HUD just read "0 unit types, 0 prefabs cached, 0
 *   entities" with no explanation. The user concluded "nothing
 *   happened." Per CLAUDE.md rule #1 (loud over silent), the failure
 *   path must surface in a UI bucket — this collector is that bucket.
 *
 * Per CLAUDE.md rule #3 (catch-all bucket): unknown sources still flow
 * into here with a `source` tag, so a future loader that warns into a
 * new source bucket auto-appears in the HUD without any plumbing edit.
 *
 * Per CLAUDE.md rule #2 (adaptive over specific): the source field is
 * `string`, NOT an enum. Adding a new loader tomorrow that pushes
 * `"navmesh"` warnings just shows up — no schema change required.
 */

/**
 * One captured warning. `source` identifies the subsystem that emitted
 * it (e.g. "schematicLoader", "prefabBank", "MatchSpawner"); `message`
 * is the human-readable line. `detail` is an optional structured blob
 * — usually the Zod issues array or an Error stack — for deep dives.
 */
export interface LoadWarning {
  readonly source: string;
  readonly message: string;
  /** Free-form structured detail. JSON-serializable. */
  readonly detail?: unknown;
}

/**
 * Mutable diagnostics bag. Threaded through every phase of MatchLoader,
 * the schematic loader, the prefab bank, and the spawner. Each layer
 * pushes its own warnings; the HUD reads them out at the end.
 *
 * Every `add` call ALSO mirrors to `console.warn` so devs working with
 * F12 open still see the same trail in chronological order — the HUD
 * is the new path, the console is the existing path, both stay.
 */
export class LoadDiagnostics {
  private readonly warnings: LoadWarning[] = [];

  add(warning: LoadWarning): void {
    this.warnings.push(warning);
    // Mirror to console so devs with F12 open see the same chain.
    // The "[load:source]" prefix keeps it greppable.
    // eslint-disable-next-line no-console
    if (warning.detail !== undefined) {
      console.warn(`[load:${warning.source}] ${warning.message}`, warning.detail);
    } else {
      console.warn(`[load:${warning.source}] ${warning.message}`);
    }
  }

  /** Convenience: push a warning from a thrown Error. */
  addFromError(source: string, message: string, error: unknown): void {
    const err =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { value: String(error) };
    this.add({ source, message, detail: err });
  }

  /** Immutable snapshot of all collected warnings, in order. */
  all(): readonly LoadWarning[] {
    return this.warnings.slice();
  }

  /** Number of warnings collected. */
  count(): number {
    return this.warnings.length;
  }

  /** Has at least one warning been collected? */
  hasAny(): boolean {
    return this.warnings.length > 0;
  }
}
