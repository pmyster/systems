/**
 * movementSystem — pure ECS behavior tests.
 *
 * Strategy: stand up a SimWorld, spawn a single entity, set component
 * values, run movementSystem, assert the SoA arrays advanced exactly
 * as the integration math predicts. No mocks; the system is a pure
 * numeric loop and the test is just the spec written in code.
 */

import { describe, it, expect } from "vitest";

import { createSimWorld } from "../world";
import { spawnUnit } from "../spawn";
import {
  MovementTarget,
  MovementSpeed,
  Position,
} from "../world";
import { movementSystem, ARRIVAL_RADIUS_M } from "./movementSystem";

function spawnAt(world: ReturnType<typeof createSimWorld>, x: number, z: number): number {
  return spawnUnit(world, {
    typeId: 0,
    x,
    y: 0,
    z,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    maxHealth: 100,
    teamId: 0,
  });
}

describe("movementSystem", () => {
  it("does nothing when hasTarget = 0", () => {
    const world = createSimWorld();
    const eid = spawnAt(world, 10, 10);
    // spawn.ts defaults hasTarget to 0.
    movementSystem(world, 1 / 30);
    expect(Position.x[eid]).toBe(10);
    expect(Position.z[eid]).toBe(10);
  });

  it("advances toward target at MovementSpeed * dt when far away", () => {
    const world = createSimWorld();
    const eid = spawnAt(world, 0, 0);
    MovementTarget.x[eid] = 100;
    MovementTarget.y[eid] = 0;
    MovementTarget.z[eid] = 0;
    MovementTarget.hasTarget[eid] = 1;
    MovementSpeed.value[eid] = 5; // 5 m/s

    // One tick at 30 Hz: 5 m/s * (1/30 s) = 0.1666… m along +X.
    movementSystem(world, 1 / 30);
    expect(Position.x[eid]).toBeCloseTo(5 / 30, 5);
    expect(Position.z[eid]).toBe(0);
    expect(MovementTarget.hasTarget[eid]).toBe(1);
  });

  it("clears hasTarget when within ARRIVAL_RADIUS_M of target", () => {
    const world = createSimWorld();
    // Spawn slightly inside the arrival radius.
    const eid = spawnAt(world, 0.1, 0.1);
    MovementTarget.x[eid] = 0;
    MovementTarget.y[eid] = 0;
    MovementTarget.z[eid] = 0;
    MovementTarget.hasTarget[eid] = 1;
    MovementSpeed.value[eid] = 5;

    // 0.1² + 0.1² = 0.02 < 0.25 = ARRIVAL_RADIUS_M²
    expect(0.1 * 0.1 + 0.1 * 0.1).toBeLessThan(
      ARRIVAL_RADIUS_M * ARRIVAL_RADIUS_M,
    );
    movementSystem(world, 1 / 30);
    expect(MovementTarget.hasTarget[eid]).toBe(0);
  });

  it("preserves Position.y (no jitter)", () => {
    const world = createSimWorld();
    const eid = spawnAt(world, 0, 0);
    Position.y[eid] = 12.5;
    MovementTarget.x[eid] = 100;
    MovementTarget.y[eid] = 0;
    MovementTarget.z[eid] = 0;
    MovementTarget.hasTarget[eid] = 1;
    MovementSpeed.value[eid] = 5;

    for (let i = 0; i < 50; i++) {
      movementSystem(world, 1 / 30);
    }
    expect(Position.y[eid]).toBe(12.5);
  });

  it("does not overshoot a near target on a single big tick", () => {
    const world = createSimWorld();
    const eid = spawnAt(world, 0, 0);
    MovementTarget.x[eid] = 2; // close target
    MovementTarget.y[eid] = 0;
    MovementTarget.z[eid] = 0;
    MovementTarget.hasTarget[eid] = 1;
    MovementSpeed.value[eid] = 1000; // absurd speed

    // One big tick should land ON the target, not past it.
    movementSystem(world, 1);
    expect(Position.x[eid]).toBe(2);
    expect(Position.z[eid]).toBe(0);
  });

  it("over many ticks, marches a distant target to arrival", () => {
    const world = createSimWorld();
    const eid = spawnAt(world, 0, 0);
    MovementTarget.x[eid] = 10;
    MovementTarget.y[eid] = 0;
    MovementTarget.z[eid] = 0;
    MovementTarget.hasTarget[eid] = 1;
    MovementSpeed.value[eid] = 5;

    // 10 m / 5 m/s = 2 sec = 60 ticks at 30 Hz. Run 200 to be safe.
    for (let i = 0; i < 200; i++) movementSystem(world, 1 / 30);
    expect(MovementTarget.hasTarget[eid]).toBe(0);
    expect(Position.x[eid]).toBeGreaterThan(10 - ARRIVAL_RADIUS_M);
  });

  it("ignores entities without MovementSpeed (cannot be queried)", () => {
    // Since spawnUnit always stamps MovementSpeed, the system query
    // naturally excludes anything that doesn't have it. Empty-world
    // call is a no-op.
    const world = createSimWorld();
    expect(() => movementSystem(world, 1 / 30)).not.toThrow();
  });
});
