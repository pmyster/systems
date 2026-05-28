/**
 * Autosave — periodic best-effort dump of the live unit state to a
 * hidden file under the app's data directory.
 *
 * Behavior contract (docs/editor-app-tauri-brief.md → "File operations"):
 *   - Every 60 seconds, write the current unit state to a temp file.
 *   - Survives crashes; restored only via an explicit "Recover" action
 *     (not implemented in v0.1; we just lay the file down here).
 *   - NEVER overwrites the user's canonical save path. Writes to
 *     `${appDataDir}/childoflight-editor/.autosave/<sessionId>.json`.
 *   - Pauses while the document is hidden so a buried tab doesn't keep
 *     spinning the disk.
 *
 * The autosave intentionally writes the in-memory unit even if it
 * doesn't pass schema validation — losing draft work to validation
 * failure would defeat the purpose. The file carries a `_autosave`
 * envelope so the Recover action can distinguish autosave dumps from
 * canonical units.
 *
 * Writes go through the custom Rust `write_unit_file` command — same as
 * Save/Save As — for consistency and to remove any dependency on the fs
 * plugin's scope semantics. `write_unit_file` calls `create_dir_all` on
 * the parent, so we don't need a separate mkdir step.
 */

import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";

import type { UnitState } from "../state/unit-store";

/** Subdirectory under appDataDir. Hidden via the leading dot. */
const AUTOSAVE_SUBDIR = "childoflight-editor/.autosave";

/** Default interval (ms) between autosave attempts. */
export const DEFAULT_AUTOSAVE_INTERVAL_MS = 60_000;

interface AutosaveEnvelope {
  readonly _autosave: true;
  readonly savedAt: string;
  readonly sourcePath: string | null;
  readonly sessionId: string;
  readonly unit: UnitState["unit"];
}

/**
 * Compute the absolute path the autosave job writes to. Exposed so
 * tests / a future Recover action can find the file deterministically.
 */
export async function getAutosavePath(sessionId: string): Promise<string> {
  const root = await appDataDir();
  return join(root, AUTOSAVE_SUBDIR, `${sessionId}.json`);
}

/**
 * Write one autosave snapshot. Synchronous return of a promise; the
 * caller may ignore failures (they shouldn't surface to the user).
 *
 * Parent-dir creation is handled inside `write_unit_file` via
 * `std::fs::create_dir_all`, so we don't need a JS-side mkdir.
 */
async function writeAutosave(state: UnitState): Promise<void> {
  const path = await getAutosavePath(state.sessionId);
  const env: AutosaveEnvelope = {
    _autosave: true,
    savedAt: new Date().toISOString(),
    sourcePath: state.file.path,
    sessionId: state.sessionId,
    unit: state.unit,
  };
  const text = JSON.stringify(env, null, 2) + "\n";
  await invoke("write_unit_file", { path, contents: text });
}

/**
 * Handle returned by startAutosave so the caller can stop it.
 */
export interface AutosaveHandle {
  /** Cancel the timer and detach listeners. */
  readonly stop: () => void;
  /** Force an immediate write (e.g. on window unload). */
  readonly flushNow: () => Promise<void>;
}

/**
 * Start the autosave job. Returns a stop handle.
 *
 * Implementation note — we use `setInterval` (not chained `setTimeout`)
 * because the visibilitychange handler needs to be able to flip the
 * timer cleanly off and back on without racing a pending callback.
 *
 * @param getState  Pull the current UnitState. The caller (App.tsx)
 *                  passes `() => stateRef.current` so the timer always
 *                  sees fresh state.
 * @param intervalMs  Override the default 60s cadence (mostly for tests).
 */
export function startAutosave(
  getState: () => UnitState,
  intervalMs: number = DEFAULT_AUTOSAVE_INTERVAL_MS,
): AutosaveHandle {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    if (stopped) return;
    // Defensive: if the page went hidden between the interval firing
    // and this callback, skip the write rather than rely on the
    // visibilitychange handler.
    if (document.visibilityState === "hidden") return;
    const state = getState();
    // Fire-and-forget; swallow errors so the timer keeps going.
    void writeAutosave(state).catch(() => {
      /* deliberately ignored — autosave is best-effort */
    });
  };

  const startTimer = (): void => {
    if (timer !== null) return;
    timer = setInterval(tick, intervalMs);
  };

  const stopTimer = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  // First write happens after one interval — match the brief's "every 60s".
  startTimer();

  const onVisibility = (): void => {
    if (stopped) return;
    if (document.visibilityState === "hidden") {
      // Pause the timer entirely while hidden — don't just skip ticks.
      stopTimer();
    } else {
      // Returned to visible — resume on the same cadence.
      startTimer();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const stop = (): void => {
    stopped = true;
    stopTimer();
    document.removeEventListener("visibilitychange", onVisibility);
  };

  const flushNow = async (): Promise<void> => {
    try {
      await writeAutosave(getState());
    } catch {
      // Best-effort.
    }
  };

  return { stop, flushNow };
}
