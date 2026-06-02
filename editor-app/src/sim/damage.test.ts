/**
 * /sim/damage.ts tests — Phase 1 Week 3.
 *
 * Golden tests anchoring the 8-step formula across the documented
 * matchup space + zone multipliers + slope cap.
 */

import { describe, it, expect, beforeEach } from "vitest";

import type { ProjectileSchematic } from "../types/projectile";
import {
  _resetDamageWarnings,
  computeDamage,
  deriveBaseDamage,
  EFFECT_VS_MATERIAL,
  pickHitZone,
  ZONE_MULT,
} from "./damage";

const KINETIC: ProjectileSchematic = {
  id: "k",
  name: "k",
  physics_version: "1.0",
  mass_kg: 2,
  delivery_params: {
    kind: "ballistic",
    muzzle_velocity_mps: 1000,
    ballistic_coefficient: 0.5,
  },
  effect_params: {
    kind: "kinetic",
    penetrator_material: "tungsten",
    sectional_density_kgm2: 10,
  },
};

const ENERGY: ProjectileSchematic = {
  id: "e",
  name: "e",
  physics_version: "1.0",
  mass_kg: 1,
  delivery_params: {
    kind: "beam",
    beam_power_kw: 100,
    dwell_time_s: 1,
    divergence_mrad: 0.2,
  },
  effect_params: {
    kind: "energy",
    joules_delivered: 50000,
    medium: "ir",
  },
};

describe("damage table integrity", () => {
  it("ZONE_MULT lists all four zones with sensible ordering", () => {
    expect(ZONE_MULT.front).toBe(1.0);
    expect(ZONE_MULT.side).toBeGreaterThan(ZONE_MULT.front);
    expect(ZONE_MULT.rear).toBeGreaterThan(ZONE_MULT.side);
    expect(ZONE_MULT.top).toBeGreaterThanOrEqual(ZONE_MULT.rear);
  });

  it("EFFECT_VS_MATERIAL covers all effect kinds with all four materials", () => {
    const kinds = ["kinetic", "explosive", "energy", "electronic", "persistent_area"] as const;
    const mats = ["steel", "composite", "reactive", "ceramic"] as const;
    for (const k of kinds) {
      for (const m of mats) {
        expect(EFFECT_VS_MATERIAL[k][m]).toBeGreaterThan(0);
      }
    }
  });
});

describe("computeDamage — kinetic vs steel", () => {
  beforeEach(() => _resetDamageWarnings());

  it("front hit normal-on penetrates with positive damage", () => {
    const r = computeDamage({
      projectile: KINETIC,
      hitZone: "front",
      zoneThicknessMm: 80,
      zoneMaterial: "steel",
      distanceM: 30,
      maxRangeM: 500,
      impactAngleRad: 0,
    });
    expect(r.finalDamage).toBeGreaterThan(0);
    expect(r.zoneMult).toBe(1.0);
    expect(r.matchup).toBe(1.0); // kinetic vs steel
  });

  it("rear hit > front hit damage (same other inputs)", () => {
    const front = computeDamage({
      projectile: KINETIC,
      hitZone: "front",
      zoneThicknessMm: 80,
      zoneMaterial: "steel",
      distanceM: 0,
      maxRangeM: 500,
      impactAngleRad: 0,
    });
    const rear = computeDamage({
      projectile: KINETIC,
      hitZone: "rear",
      zoneThicknessMm: 80,
      zoneMaterial: "steel",
      distanceM: 0,
      maxRangeM: 500,
      impactAngleRad: 0,
    });
    expect(rear.finalDamage).toBeGreaterThan(front.finalDamage);
  });
});

describe("computeDamage — energy vs ceramic", () => {
  beforeEach(() => _resetDamageWarnings());

  it("energy is reduced against ceramic vs steel (matchup < 1)", () => {
    const ceramic = computeDamage({
      projectile: ENERGY,
      hitZone: "front",
      zoneThicknessMm: 80,
      zoneMaterial: "ceramic",
      distanceM: 0,
      maxRangeM: 400,
      impactAngleRad: 0,
    });
    const steel = computeDamage({
      projectile: ENERGY,
      hitZone: "front",
      zoneThicknessMm: 80,
      zoneMaterial: "steel",
      distanceM: 0,
      maxRangeM: 400,
      impactAngleRad: 0,
    });
    expect(ceramic.matchup).toBeLessThan(steel.matchup);
  });
});

describe("computeDamage — angle obliquity cap", () => {
  beforeEach(() => _resetDamageWarnings());

  it("steeper angle increases effective thickness — capped at ~4×", () => {
    const head = computeDamage({
      projectile: KINETIC,
      hitZone: "front",
      zoneThicknessMm: 80,
      zoneMaterial: "steel",
      distanceM: 0,
      maxRangeM: 500,
      impactAngleRad: 0,
    });
    const grazing = computeDamage({
      projectile: KINETIC,
      hitZone: "front",
      zoneThicknessMm: 80,
      zoneMaterial: "steel",
      distanceM: 0,
      maxRangeM: 500,
      impactAngleRad: Math.PI / 2 - 0.01, // almost parallel
    });
    // Effective thickness should be capped — eff_thick / nominal <= 4
    expect(grazing.effThicknessMm / head.effThicknessMm).toBeLessThanOrEqual(
      4.001,
    );
  });
});

describe("pickHitZone", () => {
  it("identifies front when target faces attacker", () => {
    // Target forward = +Z. Attacker comes FROM +Z (dir = -Z).
    const zone = pickHitZone(0, 1, 0, 1);
    expect(zone).toBe("front");
  });

  it("identifies rear when target faces away", () => {
    const zone = pickHitZone(0, 1, 0, -1);
    expect(zone).toBe("rear");
  });

  it("identifies side on the flank", () => {
    const zone = pickHitZone(0, 1, 1, 0);
    expect(zone).toBe("side");
  });
});

describe("deriveBaseDamage", () => {
  it("kinetic returns a positive number for a normal ballistic round", () => {
    expect(deriveBaseDamage(KINETIC)).toBeGreaterThan(0);
  });
  it("energy returns a positive number for a beam", () => {
    expect(deriveBaseDamage(ENERGY)).toBeGreaterThan(0);
  });
});
