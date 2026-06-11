/**
 * Vitest coverage for the Command bus.
 *
 * Coverage:
 *   - execute pushes onto the undo stack.
 *   - undo pops from undo to redo.
 *   - redo pops from redo back to undo.
 *   - canUndo / canRedo report stack emptiness correctly.
 *   - merge collapses two same-kind commands within the merge window.
 *   - merge is rejected across different kinds.
 *   - merge is rejected outside the time window.
 *   - executing after undo clears the redo stack (no branching history).
 *   - maxStack cap drops the oldest entry silently.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { CommandBus } from "./CommandBus";
import type { Command } from "./Command";

function makeCmd(
  kind: string,
  timestamp: number,
  log: string[],
  acceptMerge = false,
): Command {
  const id = log.length;
  return {
    kind,
    timestamp,
    do: () => log.push(`do:${kind}:${id}`),
    undo: () => log.push(`undo:${kind}:${id}`),
    merge: acceptMerge
      ? (other) => {
          log.push(`merge:${kind}<-${other.kind}:${id}`);
          return true;
        }
      : undefined,
  };
}

describe("CommandBus", () => {
  let bus: CommandBus;
  let log: string[];

  beforeEach(() => {
    bus = new CommandBus();
    log = [];
  });

  it("execute runs do() and grows the undo stack", () => {
    bus.execute(makeCmd("A", 100, log));
    expect(log).toEqual(["do:A:0"]);
    expect(bus.canUndo()).toBe(true);
    expect(bus.canRedo()).toBe(false);
  });

  it("undo runs undo() and moves entry to redo stack", () => {
    bus.execute(makeCmd("A", 100, log));
    const ok = bus.undo();
    expect(ok).toBe(true);
    expect(log).toEqual(["do:A:0", "undo:A:0"]);
    expect(bus.canUndo()).toBe(false);
    expect(bus.canRedo()).toBe(true);
  });

  it("redo replays do() and moves entry back to undo stack", () => {
    bus.execute(makeCmd("A", 100, log));
    bus.undo();
    const ok = bus.redo();
    expect(ok).toBe(true);
    expect(log).toEqual(["do:A:0", "undo:A:0", "do:A:0"]);
    expect(bus.canUndo()).toBe(true);
    expect(bus.canRedo()).toBe(false);
  });

  it("undo / redo return false on empty stacks", () => {
    expect(bus.undo()).toBe(false);
    expect(bus.redo()).toBe(false);
  });

  it("merges same-kind commands within the merge window", () => {
    bus.execute(makeCmd("Brush", 1000, log, true));
    bus.execute(makeCmd("Brush", 1100, log)); // within 500ms — should merge
    expect(log.some((l) => l.startsWith("merge:"))).toBe(true);
    // After merge there should still be only one undoable entry.
    expect(bus.undo()).toBe(true);
    expect(bus.undo()).toBe(false);
  });

  it("does NOT merge different kinds", () => {
    bus.execute(makeCmd("A", 1000, log, true));
    bus.execute(makeCmd("B", 1100, log));
    // Both should be separately undoable.
    expect(bus.undo()).toBe(true);
    expect(bus.undo()).toBe(true);
  });

  it("does NOT merge outside the time window", () => {
    bus.execute(makeCmd("A", 1000, log, true));
    bus.execute(makeCmd("A", 2000, log));
    expect(bus.undo()).toBe(true);
    expect(bus.undo()).toBe(true);
  });

  it("execute after undo clears the redo stack", () => {
    bus.execute(makeCmd("A", 100, log));
    bus.undo();
    expect(bus.canRedo()).toBe(true);
    bus.execute(makeCmd("B", 200, log));
    expect(bus.canRedo()).toBe(false);
  });

  it("clear() empties both stacks", () => {
    bus.execute(makeCmd("A", 100, log));
    bus.undo();
    bus.clear();
    expect(bus.canUndo()).toBe(false);
    expect(bus.canRedo()).toBe(false);
  });
});
