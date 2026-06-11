/**
 * Per-effect impact visualisations for the Fire-Test.
 *
 * Each `create*Impact` factory returns an `ImpactEffect` whose lifetime
 * is driven by the scene's tick loop. The factory:
 *   - Allocates a `THREE.Group`, geometries, and materials.
 *   - Wires an `update(t01)` that scales / fades the meshes over the
 *     declared lifetime.
 *   - Exposes a `dispose()` that releases EVERY allocated geometry and
 *     material — the scene is meticulous about GPU hygiene.
 *
 * Sizing & colour decisions documented inline. The brief lists the
 * shape constraints; specifics like exact colours and pulse rates are
 * picked here and flagged in the report.
 */

import * as THREE from "three";

import { deriveProjectileStats } from "../derive-projectile";
import type {
  ElectronicEffect,
  EnergyEffect,
  EnergyMedium,
  ExplosiveEffect,
  KineticEffect,
  PersistentAreaEffect,
  PersistentAreaMedium,
  ProjectileSchematic,
} from "../../types/projectile";

export interface ImpactEffect {
  /** The scene caller adds this to its scene; the effect never adds itself. */
  readonly group: THREE.Group;
  /**
   * Advance the effect; t01 is normalised 0..1 over `lifetime_ms`. Return
   * true while alive, false when the effect should be torn down.
   */
  update(t01: number): boolean;
  dispose(): void;
  /** Total lifetime in milliseconds. The scene calculates t01 from this. */
  readonly lifetime_ms: number;
}

// ---------------------------------------------------------------------------
// Colour helpers.
// ---------------------------------------------------------------------------

const ENERGY_MEDIUM_COLOR: Readonly<Record<EnergyMedium, number>> = {
  visible: 0xffffff,
  ir: 0xff3030,
  uv: 0xa050ff,
  particle: 0x40ff60,
  plasma: 0x4080ff,
};

const PERSISTENT_MEDIUM_COLOR: Readonly<Record<PersistentAreaMedium, number>> = {
  gas: 0x808890,
  fire: 0xff6020,
  smoke: 0xc8ccd0,
  acid: 0x40d050,
};

// ---------------------------------------------------------------------------
// Kinetic — single white flash sphere.
// ---------------------------------------------------------------------------

export function createKineticImpact(
  _effect: KineticEffect,
  position: readonly [number, number, number],
): ImpactEffect {
  const lifetime_ms = 250;
  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);

  const geom = new THREE.SphereGeometry(1, 16, 12);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
  });
  const sphere = new THREE.Mesh(geom, mat);
  group.add(sphere);

  return {
    group,
    lifetime_ms,
    update(t01: number): boolean {
      if (t01 >= 1) return false;
      const scale = 0.05 + 1.45 * t01; // 0.05m → 1.5m
      sphere.scale.setScalar(scale);
      mat.opacity = 1 - t01;
      return true;
    },
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Explosive — orange-red expanding sphere + initial yellow flash.
// ---------------------------------------------------------------------------

export function createExplosiveImpact(
  effect: ExplosiveEffect,
  position: readonly [number, number, number],
  projectile: ProjectileSchematic,
): ImpactEffect {
  // Reuse the same derived blast-radius the editor stat panel shows so
  // the visual scale never disagrees with the author's stat readout.
  const derived = deriveProjectileStats(projectile);
  const radius_m = Math.max(0.5, derived.est_blast_radius_m || Math.cbrt(effect.blast_yield_mj) * 3);
  const lifetime_ms = 800;

  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);

  // Main blast sphere.
  const blastGeom = new THREE.SphereGeometry(1, 24, 18);
  const blastMat = new THREE.MeshBasicMaterial({
    color: 0xff5020,
    transparent: true,
    opacity: 1,
  });
  const blast = new THREE.Mesh(blastGeom, blastMat);
  group.add(blast);

  // Initial yellow flash — small, very short.
  const flashGeom = new THREE.SphereGeometry(1, 16, 12);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffe080,
    transparent: true,
    opacity: 1,
  });
  const flash = new THREE.Mesh(flashGeom, flashMat);
  flash.scale.setScalar(radius_m * 0.4);
  group.add(flash);

  return {
    group,
    lifetime_ms,
    update(t01: number): boolean {
      if (t01 >= 1) return false;
      // Main blast scales 0 → radius_m, opacity 1 → 0.
      blast.scale.setScalar(Math.max(0.01, radius_m * t01));
      blastMat.opacity = 1 - t01;
      // Flash burns out in the first 15% of the lifetime.
      const flash_t = Math.min(1, t01 / 0.15);
      flashMat.opacity = 1 - flash_t;
      flash.visible = flash_t < 1;
      return true;
    },
    dispose() {
      blastGeom.dispose();
      blastMat.dispose();
      flashGeom.dispose();
      flashMat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Energy — pulsing emissive disc, tint by medium.
// ---------------------------------------------------------------------------

export function createEnergyImpact(
  effect: EnergyEffect,
  position: readonly [number, number, number],
): ImpactEffect {
  const lifetime_ms = 400;
  const color = ENERGY_MEDIUM_COLOR[effect.medium];
  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);

  // CircleGeometry lies in the XY plane by default; rotate so the disc
  // faces up like a glowing puddle on the hull.
  const geom = new THREE.CircleGeometry(0.5, 24);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(geom, mat);
  disc.rotation.x = -Math.PI / 2;
  group.add(disc);

  return {
    group,
    lifetime_ms,
    update(t01: number): boolean {
      if (t01 >= 1) return false;
      // Pulse: opacity oscillates as a sine wave over the lifetime.
      const pulse = 0.5 + 0.5 * Math.sin(t01 * Math.PI * 6);
      mat.opacity = pulse * (1 - t01);
      return true;
    },
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Electronic — cyan wireframe ring expanding.
// ---------------------------------------------------------------------------

export function createElectronicImpact(
  effect: ElectronicEffect,
  position: readonly [number, number, number],
): ImpactEffect {
  const lifetime_ms = 600;
  const radius_m = Math.max(0.5, effect.area_radius_m);
  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);

  // TorusGeometry as a flat ring; thin tube to read as a wireframe.
  const geom = new THREE.TorusGeometry(1, 0.04, 8, 48);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x40e0ff,
    transparent: true,
    opacity: 1,
    wireframe: true,
  });
  const ring = new THREE.Mesh(geom, mat);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  return {
    group,
    lifetime_ms,
    update(t01: number): boolean {
      if (t01 >= 1) return false;
      const scale = Math.max(0.05, radius_m * t01);
      ring.scale.set(scale, scale, scale);
      mat.opacity = 1 - 0.8 * t01; // 1 → 0.2
      return true;
    },
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Persistent area — translucent sphere fading over duration_s.
// ---------------------------------------------------------------------------

export function createPersistentAreaImpact(
  effect: PersistentAreaEffect,
  position: readonly [number, number, number],
): ImpactEffect {
  // Visual lifetime capped at 5s — long persistent clouds shouldn't
  // freeze the Fire Test loop.
  const lifetime_ms = Math.min(5000, Math.max(800, effect.duration_s * 1000));
  const radius_m = 6;
  const color = PERSISTENT_MEDIUM_COLOR[effect.medium];

  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);

  const geom = new THREE.SphereGeometry(radius_m, 24, 18);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.4,
  });
  const cloud = new THREE.Mesh(geom, mat);
  group.add(cloud);

  return {
    group,
    lifetime_ms,
    update(t01: number): boolean {
      if (t01 >= 1) return false;
      mat.opacity = 0.4 * (1 - t01);
      return true;
    },
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatcher — picks the right factory for the projectile's effect.
//
// Loud over silent: an unhandled effect kind logs a console warning AND
// returns a minimal kinetic flash so the author still sees SOMETHING.
// The catch-all bucket here is "default kinetic flash" — never `null`.
// ---------------------------------------------------------------------------

export function createImpactForProjectile(
  projectile: ProjectileSchematic,
  position: readonly [number, number, number],
): ImpactEffect {
  const e = projectile.effect_params;
  switch (e.kind) {
    case "kinetic":
      return createKineticImpact(e, position);
    case "explosive":
      return createExplosiveImpact(e, position, projectile);
    case "energy":
      return createEnergyImpact(e, position);
    case "electronic":
      return createElectronicImpact(e, position);
    case "persistent_area":
      return createPersistentAreaImpact(e, position);
    default: {
      const _exh: never = e;
      void _exh;
      // eslint-disable-next-line no-console
      console.warn(
        `[fire-test] Unknown effect kind on projectile '${projectile.id}' — falling back to kinetic flash.`,
      );
      return createKineticImpact(
        { kind: "kinetic", penetrator_material: "steel", sectional_density_kgm2: 1 },
        position,
      );
    }
  }
}
