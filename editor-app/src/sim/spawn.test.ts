/**
 * spawn — pure-sim entity factory tests.
 *
 * Strategy: hand-build a SimWorld, call spawnUnit, then read every
 * component via the bitECS SoA arrays and assert the values the caller
 * passed in were written. No mocks, no Three.js — `/sim` is headless
 * by construction.
 */

import { describe, it, expect } from "vitest";
import { hasComponent } from "bitecs";

import { createSimWorld } from "./world";
import {
  Position,
  Rotation,
  Health,
  TeamId,
  UnitTypeId,
  Renderable,
} from "./world";
import { spawnUnit } from "./spawn";

describe("spawnUnit", () => {
  it("creates an entity with ALL six foundational components", () => {
    const world = createSimWorld();
    const eid = spawnUnit(world, {
      typeId: 0,
      x: 0,
      y: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      maxHealth: 100,
      teamId: 0,
    });
    expect(hasComponent(world, eid, Position)).toBe(true);
    expect(hasComponent(world, eid, Rotation)).toBe(true);
    expect(hasComponent(world, eid, Health)).toBe(true);
    expect(hasComponent(world, eid, TeamId)).toBe(true);
    expect(hasComponent(world, eid, UnitTypeId)).toBe(true);
    expect(hasComponent(world, eid, Renderable)).toBe(true);
  });

  it("writes Position values correctly", () => {
    const world = createSimWorld();
    const eid = spawnUnit(world, {
      typeId: 0,
      x: 12.5,
      y: -3.25,
      z: 100.75,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      maxHealth: 100,
      teamId: 0,
    });
    // Float32 storage — exact compare is safe because every value here is
    // representable.
    expect(Position.x[eid]).toBe(12.5);
    expect(Position.y[eid]).toBe(-3.25);
    expect(Position.z[eid]).toBe(100.75);
  });

  it("seeds Health.current and Health.max to the same value", () => {
    const world = createSimWorld();
    const eid = spawnUnit(world, {
      typeId: 0,
      x: 0,
      y: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      maxHealth: 250,
      teamId: 0,
    });
    expect(Health.current[eid]).toBe(250);
    expect(Health.max[eid]).toBe(250);
  });

  it("writes the identity quaternion when given (0,0,0,1)", () => {
    const world = createSimWorld();
    const eid = spawnUnit(world, {
      typeId: 0,
      x: 0,
      y: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      maxHealth: 100,
      teamId: 0,
    });
    expect(Rotation.x[eid]).toBe(0);
    expect(Rotation.y[eid]).toBe(0);
    expect(Rotation.z[eid]).toBe(0);
    expect(Rotation.w[eid]).toBe(1);
  });

  it("writes a non-identity quaternion losslessly", () => {
    const world = createSimWorld();
    // Half-rotation about Y axis: (0, sin(pi/4), 0, cos(pi/4)).
    const s = Math.SQRT1_2;
    const eid = spawnUnit(world, {
      typeId: 0,
      x: 0,
      y: 0,
      z: 0,
      qx: 0,
      qy: s,
      qz: 0,
      qw: s,
      maxHealth: 100,
      teamId: 0,
    });
    // Float32 truncation — expect close, not exact.
    expect(Rotation.x[eid]).toBeCloseTo(0, 5);
    expect(Rotation.y[eid]).toBeCloseTo(s, 5);
    expect(Rotation.z[eid]).toBeCloseTo(0, 5);
    expect(Rotation.w[eid]).toBeCloseTo(s, 5);
  });

  it("stamps TeamId and UnitTypeId from the params", () => {
    const world = createSimWorld();
    const eid = spawnUnit(world, {
      typeId: 7,
      x: 0,
      y: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      maxHealth: 100,
      teamId: 3,
    });
    expect(UnitTypeId.value[eid]).toBe(7);
    expect(TeamId.value[eid]).toBe(3);
  });

  it("allocates distinct entity ids across calls", () => {
    const world = createSimWorld();
    const a = spawnUnit(world, {
      typeId: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1,
      maxHealth: 100, teamId: 0,
    });
    const b = spawnUnit(world, {
      typeId: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1,
      maxHealth: 100, teamId: 0,
    });
    expect(a).not.toBe(b);
  });
});
