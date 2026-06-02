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

const MAX_PROJECTILES = 512;

export class ProjectileRenderer {
  readonly group: THREE.Group;
  private readonly spheres: THREE.InstancedMesh;
  private readonly beams: THREE.LineSegments;
  private readonly beamGeo: THREE.BufferGeometry;
  private readonly beamPositions: Float32Array;
  private readonly sphereMatrix = new THREE.Matrix4();
  private readonly sphereScale = new THREE.Vector3(0.35, 0.35, 0.35);
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
        const tgt = ProjectileTarget.value[p];
        const ox = ProjectileOrigin.x[p];
        const oy = ProjectileOrigin.y[p] + 0.5;
        const oz = ProjectileOrigin.z[p];
        let ex = Position.x[p];
        let ey = Position.y[p] + 0.5;
        let ez = Position.z[p];
        if (tgt !== 0 && hasComponent(world, tgt, Position)) {
          ex = Position.x[tgt];
          ey = Position.y[tgt] + 1.0;
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
      this.sphereVec.set(Position.x[p], Position.y[p] + 0.5, Position.z[p]);
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
