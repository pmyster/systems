/**
 * CombatVfxManager — Phase 1 Week 3
 *
 * Owns the render-side visual reactions to sim combat events:
 *
 *   weapon_fired  → muzzle flash sprite at the firing hardpoint
 *   impact        → scorch decal + floating damage number
 *   death         → switch the unit's mesh material to a rubble color
 *                   (entity is despawned by the sim after 60 ticks; the
 *                   instanced renderer naturally drops it then).
 *
 * One manager → one Three.js Group added to the scene. Internally:
 *   - Muzzle flashes: short-lived InstancedMesh slots (10-frame
 *     lifetime, FIFO ring buffer)
 *   - Impact decals: ground quads, fixed pool, FIFO
 *   - Damage numbers: HTML overlay managed via the props callback
 *     (so we can reuse React state). The manager exposes a
 *     subscribe-style API.
 *
 * Determinism note: visuals are NOT deterministic. They consume sim
 * events but never feed back; rendering may differ between machines
 * without breaking lockstep.
 */

import * as THREE from "three";

import type { SimEvent } from "../../../sim/events";
import type { ArmorZone } from "../../../types/vulnerability";

interface MuzzleFlashSlot {
  position: THREE.Vector3;
  bornFrame: number;
}

const MAX_FLASHES = 64;
const FLASH_LIFETIME_FRAMES = 6;
const MAX_DECALS = 128;
const DECAL_LIFETIME_FRAMES = 480; // ~8 sec at 60fps

interface DecalSlot {
  position: THREE.Vector3;
  bornFrame: number;
}

export interface DamageNumber {
  readonly id: number;
  readonly value: number;
  readonly hitZone: ArmorZone;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly bornMs: number;
}

export class CombatVfxManager {
  readonly group: THREE.Group;
  private flashes: THREE.InstancedMesh;
  private flashSlots: MuzzleFlashSlot[] = [];
  private decals: THREE.InstancedMesh;
  private decalSlots: DecalSlot[] = [];
  private frame = 0;
  private nextDamageId = 1;
  private damageNumbers: DamageNumber[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "CombatVFX";

    // Muzzle flash: small unlit orange octahedron, additive blend.
    const flashGeo = new THREE.OctahedronGeometry(0.6, 0);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd070,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flashes = new THREE.InstancedMesh(flashGeo, flashMat, MAX_FLASHES);
    this.flashes.count = 0;
    this.flashes.frustumCulled = false;
    this.flashes.name = "MuzzleFlashes";
    this.group.add(this.flashes);

    // Impact decals: dark scorch quads on the ground.
    const decalGeo = new THREE.PlaneGeometry(1.5, 1.5);
    decalGeo.rotateX(-Math.PI / 2);
    const decalMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.decals = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.name = "ImpactDecals";
    this.group.add(this.decals);
  }

  /** Consume events drained from SimEventLog. */
  ingest(events: readonly SimEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.kind) {
        case "weapon_fired":
          this.spawnFlash(e.x, e.y, e.z);
          break;
        case "impact":
          this.spawnDecal(e.x, e.y, e.z);
          this.spawnDamageNumber(e.damage, e.hitZone, e.x, e.y, e.z);
          break;
        case "death":
        case "projectile_spawned":
        case "projectile_despawned":
          // No VFX for these directly — handled elsewhere (rubble in
          // UnitRenderSystem when entity stops being rendered).
          break;
        default: {
          const _exh: never = e;
          void _exh;
          break;
        }
      }
    }
  }

  /** Per-frame update: age flashes + decals, rebuild instance matrices. */
  update(): void {
    this.frame++;
    // Age flashes.
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3(1, 1, 1);
    const quat = new THREE.Quaternion();

    const aliveFlashes: MuzzleFlashSlot[] = [];
    for (const f of this.flashSlots) {
      if (this.frame - f.bornFrame < FLASH_LIFETIME_FRAMES) aliveFlashes.push(f);
    }
    this.flashSlots = aliveFlashes;

    for (let i = 0; i < this.flashSlots.length; i++) {
      const f = this.flashSlots[i];
      const age = this.frame - f.bornFrame;
      const s = 1.5 * (1 - age / FLASH_LIFETIME_FRAMES);
      scale.set(s, s, s);
      matrix.compose(f.position, quat, scale);
      this.flashes.setMatrixAt(i, matrix);
    }
    this.flashes.count = this.flashSlots.length;
    this.flashes.instanceMatrix.needsUpdate = true;

    // Age decals — keep them around longer, just fade by aging out of
    // pool.
    const aliveDecals: DecalSlot[] = [];
    for (const d of this.decalSlots) {
      if (this.frame - d.bornFrame < DECAL_LIFETIME_FRAMES) aliveDecals.push(d);
    }
    this.decalSlots = aliveDecals;
    for (let i = 0; i < this.decalSlots.length; i++) {
      const d = this.decalSlots[i];
      matrix.compose(d.position, quat, new THREE.Vector3(1, 1, 1));
      this.decals.setMatrixAt(i, matrix);
    }
    this.decals.count = this.decalSlots.length;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** Snapshot of current damage numbers for the HUD overlay to render. */
  getDamageNumbers(): readonly DamageNumber[] {
    return this.damageNumbers;
  }

  /** Prune damage numbers older than maxAgeMs. */
  pruneDamageNumbers(nowMs: number, maxAgeMs: number): void {
    this.damageNumbers = this.damageNumbers.filter(
      (d) => nowMs - d.bornMs < maxAgeMs,
    );
  }

  private spawnFlash(x: number, y: number, z: number): void {
    if (this.flashSlots.length >= MAX_FLASHES) this.flashSlots.shift();
    this.flashSlots.push({
      position: new THREE.Vector3(x, y + 1, z),
      bornFrame: this.frame,
    });
  }

  private spawnDecal(x: number, y: number, z: number): void {
    if (this.decalSlots.length >= MAX_DECALS) this.decalSlots.shift();
    this.decalSlots.push({
      position: new THREE.Vector3(x, y + 0.01, z),
      bornFrame: this.frame,
    });
  }

  private spawnDamageNumber(
    value: number,
    hitZone: ArmorZone,
    x: number,
    y: number,
    z: number,
  ): void {
    // performance.now is fine here — render-side, not sim.
    const bornMs = performance.now();
    this.damageNumbers.push({
      id: this.nextDamageId++,
      value,
      hitZone,
      x,
      y: y + 2,
      z,
      bornMs,
    });
    // Bound the buffer to keep memory predictable.
    if (this.damageNumbers.length > 256) this.damageNumbers.shift();
  }

  dispose(): void {
    this.flashes.geometry.dispose();
    (this.flashes.material as THREE.Material).dispose();
    this.decals.geometry.dispose();
    (this.decals.material as THREE.Material).dispose();
  }
}
