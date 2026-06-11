/**
 * Module-singleton Command bus — drives all undoable state mutations.
 *
 * Stack policy:
 *   - `execute(cmd)` runs cmd.do(), then either merges into the top of
 *     the undo stack (if same-kind, within mergeWindowMs, and top accepts
 *     the merge) or pushes onto the undo stack.
 *   - Every successful execute clears the redo stack — there's no
 *     concept of branching history here, just a linear trail.
 *   - Stack is capped at `maxStack`; oldest entries fall off the floor
 *     (we never want a single session to balloon RAM with millions of
 *     brush stroke deltas).
 *
 * Why a singleton:
 *   The Map editor has one undo history per open project. When the
 *   project closes, call `clear()`.
 */

import type { Command } from "./Command";

export class CommandBus {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  /** Two commands of the same kind within this window are merge candidates. */
  private readonly mergeWindowMs = 500;
  /** Hard cap on undo history. Oldest entries are dropped silently. */
  private readonly maxStack = 200;

  execute(cmd: Command): void {
    cmd.do();
    const top = this.undoStack[this.undoStack.length - 1];
    const within =
      top !== undefined && cmd.timestamp - top.timestamp < this.mergeWindowMs;
    if (top && within && top.kind === cmd.kind && top.merge?.(cmd)) {
      // Merged into top — the new redo trail is gone because the user
      // produced more authored input. Top mutated in place.
      this.redoStack.length = 0;
      return;
    }
    this.undoStack.push(cmd);
    while (this.undoStack.length > this.maxStack) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do();
    this.undoStack.push(cmd);
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

/** One bus per open project. Reset via `clear()` on project close. */
export const mapCommandBus = new CommandBus();
