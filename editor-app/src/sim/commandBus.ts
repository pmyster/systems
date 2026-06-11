/**
 * /sim — Command bus (lockstep input log).
 *
 * Every player input is a `SimCommand` tagged with the tick at which it
 * should execute. Three properties matter:
 *
 *   1. **Replayable.** Re-executing the full log against a fresh
 *      `SimRunner` with the same seed reproduces the match exactly.
 *      Foundation for replays, post-mortems, and desync detection.
 *
 *   2. **Lockstep-friendly.** Networked multiplayer (later) ships
 *      commands instead of state. As long as each peer applies the same
 *      commands at the same ticks, world state stays in sync — no
 *      authoritative-server snapshotting required.
 *
 *   3. **Audit trail.** A "what happened on tick N" question becomes a
 *      filter, not an investigation.
 *
 * Design note: this is a *log*, not a *queue*. Commands stay in the log
 * after being applied so we can rewind / re-simulate. `clear()` exists
 * for tests and for hard resets.
 */

import type { TickId, PlayerId } from "./types";

/** Discriminator for command payloads — extend as new player actions are wired in. */
export type SimCommandKind = "spawnUnit" | "move" | "attack" | "stop";

/**
 * A scheduled player command.
 *
 * `payload` intentionally restricted to JSON-primitive numbers and strings
 * so the log can serialize losslessly to disk / network without a custom
 * codec. If a future command needs richer data, encode it as a small
 * object of primitives — never functions or class instances.
 */
export interface SimCommand {
  readonly tick: TickId;
  readonly playerId: PlayerId;
  readonly kind: SimCommandKind;
  readonly payload: Readonly<Record<string, number | string>>;
}

export class CommandBus {
  /** Append-only log. Replay = re-iterate this list against a fresh runner. */
  private log: SimCommand[] = [];

  /** Append a command. Called by the UI/input layer (or the network layer). */
  enqueue(cmd: SimCommand): void {
    this.log.push(cmd);
  }

  /**
   * Get commands scheduled for a specific tick.
   *
   * Linear scan is fine for now — Day 1 has effectively zero commands.
   * If the log grows past ~10k entries we'll bucket-by-tick, but no
   * point optimizing what isn't measured.
   */
  forTick(tickId: TickId): SimCommand[] {
    return this.log.filter((c) => c.tick === tickId);
  }

  /**
   * Read-only snapshot of the whole log, for save-to-replay-file.
   * Returned as `readonly` to discourage mutation by callers; we don't
   * copy because the typical caller serializes immediately.
   */
  snapshot(): readonly SimCommand[] {
    return this.log;
  }

  /** Restore from a replay file. Copies defensively — caller's array
   * stays unmodified by future `enqueue` calls. */
  loadFromLog(entries: readonly SimCommand[]): void {
    this.log = [...entries];
  }

  /** Drop everything. Used by tests and by a hard match reset. */
  clear(): void {
    this.log.length = 0;
  }
}
