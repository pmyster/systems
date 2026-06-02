/**
 * ReplayPlayer — render-side replay loader + playback helper.
 *
 * Loads a `.replay.json` file from disk, decodes + schema-validates it,
 * and produces the data the match-mount path needs to reconstruct the
 * recording (map dir, schematic paths, seed, team spawn config, commands,
 * expected final-state hash).
 *
 * Architectural call:
 *   In v1 we do NOT own the runtime ourselves — instead we hand a
 *   `ReplaySession` to the GameRuntime which mounts MatchScene in
 *   "replay mode" (input controllers gated off, command bus pre-loaded,
 *   final-hash verification fired when tickId reaches finalTickCount).
 *   This keeps replay reusing 95% of the live runtime path; the only
 *   difference is who writes commands. The brief's "ReplayPlayer.play"
 *   contract is preserved — the function below performs the load, the
 *   GameRuntime performs the playback. Documented as a Week 5 backlog
 *   item if we want a fully encapsulated player class.
 *
 * Loud-over-silent:
 *   - decodeReplay throws on schema mismatch with a field path.
 *   - mapProjectName / schematic resolution failures bubble up.
 *   - The final-hash check at end-of-playback emits a WARN toast (the
 *     caller wires this up via `onDriftDetected` callback).
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { decodeReplay, hashSimState, type ReplayFile } from "../../sim/replay";
import type { SimWorld } from "../../sim/world";

/** What the GameRuntime needs to set up a replay-mode match. */
export interface ReplaySession {
  readonly file: ReplayFile;
  /** Source file path on disk — surfaced in the HUD for context. */
  readonly sourcePath: string;
}

/**
 * Open a native picker, load the file, decode + validate it.
 * Returns null if the user cancels. Throws on bad file content.
 */
export async function pickAndLoadReplay(): Promise<ReplaySession | null> {
  const picked = await openDialog({
    title: "Open Replay",
    multiple: false,
    directory: false,
    filters: [{ name: "Replay JSON", extensions: ["replay.json", "json"] }],
  });
  if (picked === null || picked === undefined) return null;
  const path: string =
    typeof picked === "string"
      ? picked
      : Array.isArray(picked) && typeof picked[0] === "string"
        ? (picked[0] as string)
        : "";
  if (!path) return null;
  return loadReplayFromPath(path);
}

/** Programmatic loader — used by tests + recent-replay re-open flows. */
export async function loadReplayFromPath(path: string): Promise<ReplaySession> {
  const json = await invoke<string>("load_replay_file", { path });
  const file = decodeReplay(json);
  return { file, sourcePath: path };
}

/**
 * Verify the final sim state matches the recorded hash.
 *
 * Loud-over-silent: a drift is a real warning. The caller is expected
 * to surface a toast or HUD bucket; we don't suppress it.
 *
 * Returns the actual hash so the caller can render a "expected X got Y"
 * diagnostic if it wants to.
 */
export async function verifyReplayDrift(
  world: SimWorld,
  expectedHash: string,
): Promise<{ matched: boolean; actualHash: string }> {
  const actualHash = await hashSimState(world);
  const matched = actualHash === expectedHash;
  if (!matched) {
    console.warn(
      `[ReplayPlayer] DRIFT — expected ${expectedHash}, got ${actualHash}. ` +
        "Host on different sim version, OR non-determinism introduced. " +
        "If this fires in CI, the determinism test should have caught it first.",
    );
  }
  return { matched, actualHash };
}
