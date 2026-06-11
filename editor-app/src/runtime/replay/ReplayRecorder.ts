/**
 * ReplayRecorder — render-side wrapper that turns a live SimRunner +
 * match config into a saveable replay file.
 *
 * Responsibilities:
 *   - Capture the match config at construction (seed, schematics,
 *     team spawns, map name).
 *   - At end-of-recording, snapshot the CommandBus log, hash the
 *     final sim state, build the timestamp (render-side — sim purity
 *     forbids it inside /sim), encode, hand off to the Tauri command.
 *
 * Note on the seed: the SimRunner exposes neither `seed` nor `random`'s
 * initial value publicly. We thread the seed in via constructor (the
 * GameRuntime knows it because it constructed the runner). This is the
 * single source of truth for the seed in the recording.
 */

import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

import type { SimRunner } from "../../sim/simRunner";
import {
  encodeReplay,
  hashSimState,
  type ReplayTeamSpawn,
} from "../../sim/replay";

export interface RecorderInitArgs {
  readonly runner: SimRunner;
  readonly seed: number;
  readonly mapProjectName: string;
  readonly schematicAssetKeys: readonly string[];
  readonly teams: readonly ReplayTeamSpawn[];
}

/**
 * State machine: idle → recording → saving → idle.
 * Calling `start()` while already recording is a no-op + warn (loud-
 * over-silent — the UI should never call it, but if it does we want
 * to see the asymmetry).
 */
export class ReplayRecorder {
  private readonly args: RecorderInitArgs;
  private recording = false;
  private startedAtIso: string | null = null;
  /**
   * Tick at which recording began. Stored so the saved log can be
   * trimmed to "from-this-tick-onward" if we ever support mid-match
   * recording. Phase 1 always records from tick 0.
   */
  private startTick = 0;

  constructor(args: RecorderInitArgs) {
    this.args = args;
  }

  isRecording(): boolean {
    return this.recording;
  }

  /** Wall-clock ISO timestamp of when recording began (or null if idle). */
  getStartedAtIso(): string | null {
    return this.startedAtIso;
  }

  /** Begin recording. Captures the start ISO timestamp render-side. */
  start(): void {
    if (this.recording) {
      console.warn("[ReplayRecorder] start() called while already recording — ignoring");
      return;
    }
    this.recording = true;
    // ISO timestamp is generated HERE (render-side). Sim purity forbids
    // Date inside /sim — the replay encoder accepts this as a parameter.
    this.startedAtIso = new Date().toISOString();
    this.startTick = this.args.runner.clock.tickId;
  }

  /**
   * Stop recording, open a save dialog, write the file.
   * Returns the path written, or null if the user cancelled the dialog.
   */
  async stopAndSave(suggestedFileName = "match.replay.json"): Promise<string | null> {
    if (!this.recording) {
      console.warn("[ReplayRecorder] stopAndSave() called while idle — ignoring");
      return null;
    }
    this.recording = false;
    const startedIso = this.startedAtIso ?? new Date().toISOString();
    this.startedAtIso = null;

    const runner = this.args.runner;
    const finalTickCount = runner.clock.tickId - this.startTick;

    // Hash the world BEFORE we move it to disk so a playback audit can
    // verify the runner's sim state matched what was recorded.
    const finalStateHash = await hashSimState(runner.world);

    const json = encodeReplay({
      mapProjectName: this.args.mapProjectName,
      schematicAssetKeys: this.args.schematicAssetKeys,
      teams: this.args.teams,
      simSeed: this.args.seed,
      commands: [...runner.commands.snapshot()],
      recordedAtTickStartIso: startedIso,
      finalTickCount,
      finalStateHash,
    });

    // Open the native Save dialog so the user picks where the replay lands.
    const picked = await saveDialog({
      title: "Save Replay",
      defaultPath: suggestedFileName,
      filters: [{ name: "Replay JSON", extensions: ["replay.json", "json"] }],
    });
    if (picked === null || picked === undefined) {
      return null;
    }
    const path: string = typeof picked === "string" ? picked : String(picked);

    // Hand off to Rust. Loud-over-silent: any I/O error propagates up.
    const written = await invoke<string>("save_replay_file", {
      path,
      json,
    });
    return written;
  }

  /**
   * Abandon the current recording WITHOUT writing anything. Used on
   * unmount so a dangling state doesn't survive across matches.
   */
  cancel(): void {
    this.recording = false;
    this.startedAtIso = null;
  }
}
