/**
 * bunkerHealSystem tests — Phase 2 Stage 1.
 *
 * Cover the five behaviors a healer needs to honor:
 *   1. Friendly in range gets healed.
 *   2. Enemy in range is ignored.
 *   3. Friendly out of range is ignored.
 *   4. Healing clamps at Health.max (no overhealing).
 *   5. Multiple bunkers stack heals additively.
 *   6. radiusM <= 0 surfaces a warn (loud-over-silent gate) + does no
 *      healing on subsequent ticks.
 */

import { describe, it, expect, vi } from "vitest";
import { addComponent } from "bitecs";

import {
  createSimWorld,
  Dead,
  Health,
  Position,
  BunkerHealRange,
} from "../world";
import { spawnUnit } from "../spawn";
import { bunkerHealSystem } from "./bunkerHealSystem";

function makeBunker(
  world: ReturnType<typeof createSimWorld>,
  x: number,
  z: number,
  team: number,
  radiusM: number,
  healMj: number,
): number {
  const eid = spawnUnit(world, {
    typeId: 0,
    x, y: 0, z,
    qx: 0, qy: 0, qz: 0, qw: 1,
    maxHealth: 1000,
    teamId: team,
  });
  addComponent(world, eid, BunkerHealRange);
  BunkerHealRange.radiusM[eid] = radiusM;
  BunkerHealRange.healPerTickMj[eid] = healMj;
  return eid;
}

function makeUnit(
  world: ReturnType<typeof createSimWorld>,
  x: number,
  z: number,
  team: number,
  hp: number,
  maxHp: number,
): number {
  const eid = spawnUnit(world, {
    typeId: 1,
    x, y: 0, z,
    qx: 0, qy: 0, qz: 0, qw: 1,
    maxHealth: maxHp,
    teamId: team,
  });
  Health.current[eid] = hp;
  return eid;
}

describe("bunkerHealSystem", () => {
  it("heals a friendly unit in range", () => {
    const world = createSimWorld();
    makeBunker(world, 0, 0, /*team*/ 0, /*radius*/ 10, /*healMj*/ 5);
    const ally = makeUnit(world, 5, 0, /*team*/ 0, /*hp*/ 50, /*max*/ 100);

    bunkerHealSystem(world);

    expect(Health.current[ally]).toBe(55);
  });

  it("does NOT heal an enemy unit in range", () => {
    const world = createSimWorld();
    makeBunker(world, 0, 0, /*team*/ 0, /*radius*/ 10, /*healMj*/ 5);
    const foe = makeUnit(world, 5, 0, /*team*/ 1, /*hp*/ 50, /*max*/ 100);

    bunkerHealSystem(world);

    expect(Health.current[foe]).toBe(50);
  });

  it("does NOT heal a friendly unit out of range", () => {
    const world = createSimWorld();
    makeBunker(world, 0, 0, /*team*/ 0, /*radius*/ 10, /*healMj*/ 5);
    const ally = makeUnit(world, 50, 0, /*team*/ 0, /*hp*/ 50, /*max*/ 100);

    bunkerHealSystem(world);

    expect(Health.current[ally]).toBe(50);
  });

  it("clamps healing at Health.max — no overheal", () => {
    const world = createSimWorld();
    makeBunker(world, 0, 0, /*team*/ 0, /*radius*/ 10, /*healMj*/ 500);
    const ally = makeUnit(world, 5, 0, /*team*/ 0, /*hp*/ 95, /*max*/ 100);

    bunkerHealSystem(world);

    expect(Health.current[ally]).toBe(100);
    // Re-run; should remain at 100.
    bunkerHealSystem(world);
    expect(Health.current[ally]).toBe(100);
  });

  it("multiple bunkers stack heals additively on the same ally", () => {
    const world = createSimWorld();
    makeBunker(world, 0, 0, /*team*/ 0, /*radius*/ 10, /*healMj*/ 3);
    makeBunker(world, 1, 1, /*team*/ 0, /*radius*/ 10, /*healMj*/ 7);
    const ally = makeUnit(world, 5, 5, /*team*/ 0, /*hp*/ 50, /*max*/ 100);

    bunkerHealSystem(world);

    // 50 + 3 (bunker A) + 7 (bunker B) = 60.
    expect(Health.current[ally]).toBe(60);
  });

  it("warns once and stays inert when radius <= 0", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const world = createSimWorld();
      const bunker = makeBunker(world, 0, 0, /*team*/ 0, /*radius*/ 0, /*healMj*/ 5);
      const ally = makeUnit(world, 5, 0, /*team*/ 0, /*hp*/ 50, /*max*/ 100);

      bunkerHealSystem(world);
      bunkerHealSystem(world);

      // No healing happened.
      expect(Health.current[ally]).toBe(50);
      // Warn fired ONCE — the bunker's sentinel suppressed the second.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // Sentinel was stamped.
      expect(BunkerHealRange.radiusM[bunker]).toBeLessThan(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("skips dead bunkers (Dead tag)", () => {
    // Just import Dead lazily and apply it — simulating the
    // post-impactSystem state.
    const world = createSimWorld();
    const bunker = makeBunker(world, 0, 0, 0, 10, 5);
    const ally = makeUnit(world, 5, 0, 0, 50, 100);
    // Tag the bunker dead.
    addComponent(world, bunker, Dead);

    bunkerHealSystem(world);

    expect(Health.current[ally]).toBe(50);
  });

  it("does not heal other bunkers (same-team bunker not in heal list)", () => {
    const world = createSimWorld();
    makeBunker(world, 0, 0, 0, 20, 5);
    const otherBunker = makeBunker(world, 5, 0, 0, 20, 5);
    Health.current[otherBunker] = 300;

    bunkerHealSystem(world);

    // Other bunker's health unchanged (bunker-on-bunker healing skipped
    // by the BunkerHealRange-on-target check).
    expect(Health.current[otherBunker]).toBe(300);
  });

  it("uses XZ distance (Y delta is irrelevant)", () => {
    const world = createSimWorld();
    makeBunker(world, 0, 0, 0, 10, 5);
    const ally = makeUnit(world, 5, 0, 0, 50, 100);
    // Move ally up 1000m in Y; system should still heal because we use XZ.
    Position.y[ally] = 1000;

    bunkerHealSystem(world);

    expect(Health.current[ally]).toBe(55);
  });

  it("idempotent on multiple no-bunker worlds", () => {
    const world = createSimWorld();
    makeUnit(world, 5, 0, 0, 50, 100);

    expect(() => bunkerHealSystem(world)).not.toThrow();
    expect(() => bunkerHealSystem(world)).not.toThrow();
  });
});
