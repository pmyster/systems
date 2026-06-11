/**
 * commandApplySystem — command → component-write tests.
 *
 * Strategy: spawn a few entities, build SimCommand payloads, apply,
 * read component SoA arrays and assert. Also assert loud-over-silent
 * behavior for unknown command kinds and malformed payloads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSimWorld, MovementTarget } from "../world";
import { spawnUnit } from "../spawn";
import type { SimCommand, SimCommandKind } from "../commandBus";
import { applyCommands } from "./commandApplySystem";

function spawnEnt(world: ReturnType<typeof createSimWorld>): number {
  return spawnUnit(world, {
    typeId: 0, x: 0, y: 0, z: 0,
    qx: 0, qy: 0, qz: 0, qw: 1,
    maxHealth: 100, teamId: 0,
  });
}

function cmd(kind: SimCommandKind, payload: Record<string, number | string>): SimCommand {
  return { tick: 0, playerId: 0, kind, payload };
}

describe("applyCommands — move", () => {
  it("sets MovementTarget + hasTarget=1 for every listed entity", () => {
    const world = createSimWorld();
    const a = spawnEnt(world);
    const b = spawnEnt(world);
    applyCommands(world, [
      cmd("move", { x: 50, z: -25, entityIds: `${a},${b}` }),
    ]);
    expect(MovementTarget.x[a]).toBe(50);
    expect(MovementTarget.z[a]).toBe(-25);
    expect(MovementTarget.hasTarget[a]).toBe(1);
    expect(MovementTarget.x[b]).toBe(50);
    expect(MovementTarget.z[b]).toBe(-25);
    expect(MovementTarget.hasTarget[b]).toBe(1);
  });

  it("zeros MovementTarget.y (sim Y is unused — render samples heightmap)", () => {
    const world = createSimWorld();
    const e = spawnEnt(world);
    MovementTarget.y[e] = 99; // pretend a stale value
    applyCommands(world, [cmd("move", { x: 1, z: 1, entityIds: `${e}` })]);
    expect(MovementTarget.y[e]).toBe(0);
  });

  it("handles a single-entity payload (no comma)", () => {
    const world = createSimWorld();
    const e = spawnEnt(world);
    applyCommands(world, [cmd("move", { x: 1, z: 2, entityIds: `${e}` })]);
    expect(MovementTarget.hasTarget[e]).toBe(1);
  });

  it("empty entityIds is a no-op (legitimate: 'move with nothing selected')", () => {
    const world = createSimWorld();
    const e = spawnEnt(world);
    applyCommands(world, [cmd("move", { x: 1, z: 2, entityIds: "" })]);
    expect(MovementTarget.hasTarget[e]).toBe(0);
  });
});

describe("applyCommands — stop", () => {
  it("clears MovementTarget.hasTarget for listed entities", () => {
    const world = createSimWorld();
    const a = spawnEnt(world);
    const b = spawnEnt(world);
    MovementTarget.hasTarget[a] = 1;
    MovementTarget.hasTarget[b] = 1;
    applyCommands(world, [cmd("stop", { entityIds: `${a},${b}` })]);
    expect(MovementTarget.hasTarget[a]).toBe(0);
    expect(MovementTarget.hasTarget[b]).toBe(0);
  });
});

describe("applyCommands — loud-over-silent defensive surfaces", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("unknown command kind logs a warn (does not throw)", () => {
    const world = createSimWorld();
    spawnEnt(world);
    const bogus: SimCommand = {
      tick: 0,
      playerId: 0,
      // bypass the union to simulate UI ↔ sim version skew
      kind: "patrol" as unknown as SimCommandKind,
      payload: { x: 1, z: 1 },
    };
    expect(() => applyCommands(world, [bogus])).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    const msgs = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(msgs.some((m: string) => m.includes("unknown command kind"))).toBe(true);
  });

  it("non-finite move target logs warn and skips writes", () => {
    const world = createSimWorld();
    const e = spawnEnt(world);
    applyCommands(world, [
      cmd("move", { x: "nope", z: 1, entityIds: `${e}` }),
    ]);
    expect(MovementTarget.hasTarget[e]).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("non-integer entityIds entries are dropped with a warn (surviving ids still apply)", () => {
    const world = createSimWorld();
    const a = spawnEnt(world);
    applyCommands(world, [
      cmd("move", { x: 1, z: 2, entityIds: `${a},xxx,9.5` }),
    ]);
    // `a` still moved, garbage ignored, warn logged.
    expect(MovementTarget.hasTarget[a]).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
  });
});
