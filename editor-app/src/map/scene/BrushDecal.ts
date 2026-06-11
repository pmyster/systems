/**
 * BrushDecal — translucent ring that hovers above the terrain to show
 * where the next sculpt stroke will land.
 *
 * Implementation notes:
 *   - RingGeometry generates a ring on the XY plane; we rotate to XZ so
 *     it lays flat on the (Y-up) terrain.
 *   - `depthTest: false` + `renderOrder: 999` ensures the ring is always
 *     visible even when it floats slightly INTO the terrain due to
 *     surface roughness. We still nudge the Y up by 0.05m for good
 *     measure.
 *   - Radius changes recreate the geometry. RingGeometry has no public
 *     "resize" API; recreating is the simplest correct approach. The
 *     prior geometry is disposed to release its GPU buffer.
 */

import * as THREE from "three";

const RING_THICKNESS_M = 0.15;
const RING_SEGMENTS = 48;

export class BrushDecal {
  readonly mesh: THREE.Mesh;
  private geometry: THREE.RingGeometry;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(initialRadiusM: number) {
    this.geometry = BrushDecal.buildGeometry(initialRadiusM);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffcc55,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = "BrushDecal";
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
  }

  private static buildGeometry(radiusM: number): THREE.RingGeometry {
    const outer = Math.max(0.1, radiusM);
    const inner = Math.max(0.05, outer - RING_THICKNESS_M);
    const g = new THREE.RingGeometry(inner, outer, RING_SEGMENTS);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  show(worldX: number, worldZ: number, worldY: number): void {
    this.mesh.position.set(worldX, worldY + 0.05, worldZ);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  setRadius(radiusM: number): void {
    this.geometry.dispose();
    this.geometry = BrushDecal.buildGeometry(radiusM);
    this.mesh.geometry = this.geometry;
  }

  setColor(hex: number): void {
    this.material.color.setHex(hex);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
