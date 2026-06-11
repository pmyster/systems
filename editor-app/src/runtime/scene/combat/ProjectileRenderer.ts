/**
 * ProjectileRenderer — Phase 1 Week 3
 *
 * Renders every in-flight projectile in the sim. Two visual paths:
 *
 *   Ballistic / Guided / Dropped / Placed — a small unlit sphere mesh
 *     pooled out of an InstancedMesh (single draw call regardless of
 *     projectile count).
 *
 *   Beam — a thin line segment from the projectile's origin to the
 *     locked target's position, alive for the brief lifetime of the
 *     beam entity. Implemented as a separate LineSegments mesh whose
 *     buffer is rebuilt each frame.
 *
 * The renderer pulls position + kind + origin + target eid from the
 * sim each frame (Position, ProjectileKind, ProjectileOrigin,
 * ProjectileTarget). No event subscription — we read the world state.
 *
 * Lifecycle:
 *   construct() once per match → add `group` to the scene.
 *   update(world) once per frame.
 *   dispose() on match teardown.
 *
 * Loud-over-silent: unknown projectile kind falls through to the
 * ballistic sphere bucket with a one-time warn.
 */

import * as THREE from "three";
import { query, hasComponent } from "bitecs";

import {
  DeliveryKindValue,
  Position,
  ProjectileKind,
  ProjectileOrigin,
  ProjectileTag,
  ProjectileTarget,
  type SimWorld,
} from "../../../sim/world";
import { UNIT_RENDER_SCALE } from "../../loader/prefabBank";

const MAX_PROJECTILES = 512;

// Projectile visual primitives are sized in NATIVE sim meters (chassis-
// scale) so they match the source authoring. They render at
// UNIT_RENDER_SCALE so they stay proportional to the rendered tank.
// The line width is intentionally not scaled — Three.js line width is a
// pixel-space property in WebGL, not a world-space one, so leaving it at
// the material default keeps beams visible on all DPI configurations.
const PROJECTILE_SPHERE_RADIUS_M = 0.35; // ~ "shell" baseline
// Visible beam thickness floor — at UNIT_RENDER_SCALE = 0.1 the beam
// would otherwise compute to ~0.05m, well below a pixel at typical
// zoom. We sidestep by keeping the LineSegments default thickness; the
// floor is documented here so future authors don't try to scale it.
const PROJECTILE_BEAM_Y_OFFSET_M = 0.5;
const PROJECTILE_BEAM_TARGET_Y_OFFSET_M = 1.0;
const PROJECTILE_SPHERE_Y_OFFSET_M = 0.5;

export class ProjectileRenderer {
  readonly group: THREE.Group;
  private readonly spheres: THREE.InstancedMesh;
  private readonly beams: THREE.LineSegments;
  private readonly beamGeo: THREE.BufferGeometry;
  private readonly beamPositions: Float32Array;
  private readonly sphereMatrix = new THREE.Matrix4();
  // Sphere base geometry is a unit sphere; sphereScale carries the
  // visual radius in render-space meters. With UNIT_RENDER_SCALE = 0.1,
  // a 0.35m source radius becomes 0.035m on screen — matches the tiny
  // tanks.
  private readonly sphereScale = new THREE.Vector3(
    PROJECTILE_SPHERE_RADIUS_M * UNIT_RENDER_SCALE,
    PROJECTILE_SPHERE_RADIUS_M * UNIT_RENDER_SCALE,
    PROJECTILE_SPHERE_RADIUS_M * UNIT_RENDER_SCALE,
  );
  private readonly sphereQuat = new THREE.Quaternion();
  private readonly sphereVec = new THREE.Vector3();
  private warnedKinds = new Set<number>();

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "ProjectileGroup";

    const sphereGeo = new THREE.SphereGeometry(1, 6, 4);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffe07a });
    this.spheres = new THREE.InstancedMesh(
      sphereGeo,
      sphereMat,
      MAX_PROJECTILES,
    );
    this.spheres.count = 0;
    this.spheres.frustumCulled = false;
    this.spheres.name = "ProjectileSpheres";
    this.group.add(this.spheres);

    // Two endpoints per beam = 6 floats per beam.
    this.beamPositions = new Float32Array(MAX_PROJECTILES * 6);
    this.beamGeo = new THREE.BufferGeometry();
    this.beamGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.beamPositions, 3),
    );
    this.beamGeo.setDrawRange(0, 0);
    const beamMat = new THREE.LineBasicMaterial({ color: 0xff5050 });
    this.beams = new THREE.LineSegments(this.beamGeo, beamMat);
    this.beams.frustumCulled = false;
    this.beams.name = "ProjectileBeams";
    this.group.add(this.beams);
  }

  update(world: SimWorld): void {
    const ents = query(world, [ProjectileTag, Position, ProjectileKind]);
    let sphereCount = 0;
    let beamCount = 0;

    for (let i = 0; i < ents.length; i++) {
      const p = ents[i];
      const kind = ProjectileKind.value[p];
      if (kind === DeliveryKindValue.Beam) {
        // Draw line from origin to target position (or end of range).
        // Y offsets are chassis-relative "lift above center" amounts in
        // native sim meters → scale to render-space.
        const tgt = ProjectileTarget.value[p];
        const ox = ProjectileOrigin.x[p];
        const oy = ProjectileOrigin.y[p] + PROJECTILE_BEAM_Y_OFFSET_M * UNIT_RENDER_SCALE;
        const oz = ProjectileOrigin.z[p];
        let ex = Position.x[p];
        let ey = Position.y[p] + PROJECTILE_BEAM_Y_OFFSET_M * UNIT_RENDER_SCALE;
        let ez = Position.z[p];
        if (tgt !== 0 && hasComponent(world, tgt, Position)) {
          ex = Position.x[tgt];
          ey = Position.y[tgt] + PROJECTILE_BEAM_TARGET_Y_OFFSET_M * UNIT_RENDER_SCALE;
          ez = Position.z[tgt];
        }
        const off = beamCount * 6;
        this.beamPositions[off + 0] = ox;
        this.beamPositions[off + 1] = oy;
        this.beamPositions[off + 2] = oz;
        this.beamPositions[off + 3] = ex;
        this.beamPositions[off + 4] = ey;
        this.beamPositions[off + 5] = ez;
        beamCount++;
        if (beamCount >= MAX_PROJECTILES) break;
        continue;
      }
      // Sphere bucket (ballistic + every fallback).
      if (
        kind !== DeliveryKindValue.Ballistic &&
        kind !== DeliveryKindValue.Guided &&
        kind !== DeliveryKindValue.Dropped &&
        kind !== DeliveryKindValue.Placed
      ) {
        if (!this.warnedKinds.has(kind)) {
          console.warn(
            `[ProjectileRenderer] unknown projectile kind ${kind} — rendering as sphere`,
          );
          this.warnedKinds.add(kind);
        }
      }
      this.sphereVec.set(
        Position.x[p],
        Position.y[p] + PROJECTILE_SPHERE_Y_OFFSET_M * UNIT_RENDER_SCALE,
        Position.z[p],
      );
      this.sphereMatrix.compose(
        this.sphereVec,
        this.sphereQuat,
        this.sphereScale,
      );
      this.spheres.setMatrixAt(sphereCount, this.sphereMatrix);
      sphereCount++;
      if (sphereCount >= MAX_PROJECTILES) break;
    }

    this.spheres.count = sphereCount;
    this.spheres.instanceMatrix.needsUpdate = true;
    this.beamGeo.setDrawRange(0, beamCount * 2);
    if (beamCount > 0) {
      const attr = this.beamGeo.getAttribute("position") as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.spheres.geometry.dispose();
    (this.spheres.material as THREE.Material).dispose();
    this.beamGeo.dispose();
    (this.beams.material as THREE.Material).dispose();
  }
}
