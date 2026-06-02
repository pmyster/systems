/**
 * CommandBus — log behavior tests.
 *
 * The log is the foundation for replay/save and lockstep MP, so the
 * tests focus on: do commands round-trip losslessly? Does loadFromLog
 * actually replace state? Is snapshot a stable view of "what happened"?
 */

import { describe, it, expect } from "vitest";
import { CommandBus, type SimCommand } from "./commandBus";

function makeCmd(tick: number, playerId = 0): SimCommand {
  return { tick, playerId, kind: "move", payload: { x: 1, y: 2 } };
}

describe("CommandBus", () => {
  it("enqueue + forTick returns matching commands", () => {
    const bus = new CommandBus();
    bus.enqueue(makeCmd(0));
    bus.enqueue(makeCmd(5));
    bus.enqueue(makeCmd(5, 1));
    bus.enqueue(makeCmd(10));
    const tick5 = bus.forTick(5);
    expect(tick5).toHaveLength(2);
    expect(tick5.every((c) => c.tick === 5)).toBe(true);
    expect(bus.forTick(99)).toHaveLength(0);
  });

  it("snapshot returns all commands in insertion order", () => {
    const bus = new CommandBus();
    const cmds = [makeCmd(0), makeCmd(1), makeCmd(2)];
    cmds.forEach((c) => bus.enqueue(c));
    const snap = bus.snapshot();
    expect(snap).toHaveLength(3);
    expect(snap[0]).toBe(cmds[0]);
    expect(snap[1]).toBe(cmds[1]);
    expect(snap[2]).toBe(cmds[2]);
  });

  it("loadFromLog replaces the log and decouples from caller array", () => {
    const bus = new CommandBus();
    bus.enqueue(makeCmd(0));
    const replay: SimCommand[] = [makeCmd(10), makeCmd(20)];
    bus.loadFromLog(replay);
    expect(bus.snapshot()).toHaveLength(2);
    // Mutating the source array after load must NOT affect the bus.
    replay.push(makeCmd(30));
    expect(bus.snapshot()).toHaveLength(2);
  });

  it("clear() empties the log", () => {
    const bus = new CommandBus();
    bus.enqueue(makeCmd(0));
    bus.enqueue(makeCmd(1));
    bus.clear();
    expect(bus.snapshot()).toHaveLength(0);
    expect(bus.forTick(0)).toHaveLength(0);
  });

  it("round-trips through snapshot → loadFromLog (replay shape)", () => {
    const original = new CommandBus();
    original.enqueue(makeCmd(0));
    original.enqueue(makeCmd(7));
    original.enqueue(makeCmd(12, 2));
    const saved: readonly SimCommand[] = original.snapshot();

    const restored = new CommandBus();
    restored.loadFromLog(saved);
    expect(restored.snapshot()).toEqual(original.snapshot());
  });
});
