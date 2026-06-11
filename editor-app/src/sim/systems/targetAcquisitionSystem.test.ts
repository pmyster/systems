/**
 * targetAcquisitionSystem tests — Phase 1 Week 3.
 *
 * The strategy: stand up a fresh world, spawn unit + weapon entities,
 * set their fields, run the system, assert the WeaponTarget /
 * TargetOf values match the spec.
 */

import { describe, it, expect } from "vitest";
import { addComponent } from "bitecs";

import { createSimWorld } from "../world";
import { spawnUnit, spawnWeaponInstance } from "../spawn";
import {
  AAFiringArc,
  Health,
  Position,
  ScanRange,
  Stance,
  StanceValue,
  TargetOf,
  WallNoFire,
  WeaponTarget,
  NO_ENTITY,
} from "../world";
import { targetAcquisitionSystem } from "./targetAcquisitionSystem";

function spawnUnitAt(
  world: ReturnType<typeof createSimWorld>,
  x: number,
  z: number,
  team: number,
): number {
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
    teamId: team,
  });
}

function spawnWeapon(world: ReturnType<typeof createSimWorld>, owner: number): number {
  return spawnWeaponInstance(world, {
    ownerEid: owner,
    hardpointIdx: 0,
    projectileTypeId: 0,
    chargeTimeMs: 0,
    fireRateMs: 0,
    burstCount: 1,
    burstDelayMs: 0,
    cooldownMs: 100,
    thermalCapMj: 50,
    heatPerShotMj: 3,
    coolRateMjs: 2,
    rangeM: 100,
  });
}

describe("targetAcquisitionSystem", () => {
  it("acquires an opposing-team enemy in range", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    const enemy = spawnUnitAt(world, 30, 0, 1);
    ScanRange.value[me] = 80;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(enemy);
    expect(TargetOf.value[me]).toBe(enemy);
  });

  it("does not acquire an enemy outside scan range", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    spawnUnitAt(world, 200, 0, 1);
    ScanRange.value[me] = 50;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(NO_ENTITY);
    expect(TargetOf.value[me]).toBe(NO_ENTITY);
  });

  it("does not target a teammate", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    spawnUnitAt(world, 20, 0, 0); // same team
    ScanRange.value[me] = 80;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(NO_ENTITY);
  });

  it("HoldFire clears WeaponTarget", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    const enemy = spawnUnitAt(world, 30, 0, 1);
    ScanRange.value[me] = 80;
    Stance.value[me] = StanceValue.HoldFire;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(NO_ENTITY);
    void enemy;
  });

  it("clears target when current target dies", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    const enemy = spawnUnitAt(world, 30, 0, 1);
    ScanRange.value[me] = 80;

    targetAcquisitionSystem(world);
    expect(WeaponTarget.value[w]).toBe(enemy);

    // Kill the enemy.
    Health.current[enemy] = 0;
    targetAcquisitionSystem(world);
    expect(WeaponTarget.value[w]).toBe(NO_ENTITY);
    expect(TargetOf.value[me]).toBe(NO_ENTITY);
  });

  it("prefers the closer of two enemies (proximity weight dominates at equal health)", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    const far = spawnUnitAt(world, 70, 0, 1);
    const near = spawnUnitAt(world, 20, 0, 1);
    ScanRange.value[me] = 80;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(near);
    void far;
  });
});

// ---------------------------------------------------------------------------
// Phase 2 Stage 1 — AA + Wall acquisition semantics.
// ---------------------------------------------------------------------------

describe("targetAcquisitionSystem — Phase 2 Stage 1 building behaviors", () => {
  // Helpers we don't pollute the top-level scope with.
  function makeAAUnit(
    world: ReturnType<typeof createSimWorld>,
    x: number,
    y: number,
    z: number,
    team: number,
    pitchMinRad: number,
  ): number {
    const eid = spawnUnit(world, {
      typeId: 0,
      x, y, z,
      qx: 0, qy: 0, qz: 0, qw: 1,
      maxHealth: 100,
      teamId: team,
    });
    addComponent(world, eid, AAFiringArc);
    AAFiringArc.pitchMinRad[eid] = pitchMinRad;
    AAFiringArc.pitchMaxRad[eid] = Math.PI / 2;
    return eid;
  }

  function makeWallUnit(
    world: ReturnType<typeof createSimWorld>,
    x: number,
    z: number,
    team: number,
  ): number {
    const eid = spawnUnit(world, {
      typeId: 2,
      x, y: 0, z,
      qx: 0, qy: 0, qz: 0, qw: 1,
      maxHealth: 500,
      teamId: team,
    });
    addComponent(world, eid, WallNoFire);
    return eid;
  }

  it("AA tower does NOT acquire a ground target (no Flying tag, fails pitch gate)", () => {
    const world = createSimWorld();
    // AA tower at origin, ground enemy 30m away at y=0.
    const aaTower = makeAAUnit(world, 0, 5, 0, /*team*/ 0, /*pitchMinRad*/ 0.349);
    const w = spawnWeapon(world, aaTower);
    spawnUnitAt(world, 30, 0, 1);
    ScanRange.value[aaTower] = 80;

    targetAcquisitionSystem(world);

    // Ground enemy is BELOW the AA's horizon → no acquisition.
    expect(WeaponTarget.value[w]).toBe(NO_ENTITY);
  });

  it("AA tower DOES acquire a target above its pitchMinRad", () => {
    const world = createSimWorld();
    // AA tower at origin, target 30m away at y=50 (steeply above horizon).
    const aaTower = makeAAUnit(world, 0, 0, 0, /*team*/ 0, /*pitchMinRad*/ 0.349);
    const w = spawnWeapon(world, aaTower);
    const highFlyer = spawnUnit(world, {
      typeId: 0,
      x: 30, y: 50, z: 0,
      qx: 0, qy: 0, qz: 0, qw: 1,
      maxHealth: 100,
      teamId: 1,
    });
    ScanRange.value[aaTower] = 80;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(highFlyer);
  });

  it("walls are NOT acquired by allied turrets (same team)", () => {
    const world = createSimWorld();
    // Ally turret + ally wall + enemy turret.
    const ally = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, ally);
    // Wall on the SAME team as the firing unit — should not be acquired.
    const allyWall = makeWallUnit(world, 10, 0, 0);
    // Enemy in range so we can be sure something CAN be acquired.
    const enemy = spawnUnitAt(world, 30, 0, 1);
    ScanRange.value[ally] = 80;

    targetAcquisitionSystem(world);

    // Acquires the enemy, NOT the allied wall.
    expect(WeaponTarget.value[w]).toBe(enemy);
    expect(WeaponTarget.value[w]).not.toBe(allyWall);
  });

  it("walls ARE acquired by enemy units (enemies need to shoot through them)", () => {
    const world = createSimWorld();
    const enemyTurret = spawnUnitAt(world, 0, 0, 1); // team 1
    const w = spawnWeapon(world, enemyTurret);
    // Wall on team 0 — visible as an enemy to team 1's turret.
    const wall = makeWallUnit(world, 30, 0, 0);
    ScanRange.value[enemyTurret] = 80;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(wall);
  });
});

// Suppress accidental ScanRange unused lint
void Position;
