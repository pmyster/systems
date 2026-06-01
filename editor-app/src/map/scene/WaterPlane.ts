/**
 * WaterPlane — translucent plane sitting at world y=0 covering the full
 * terrain extent. Wherever the terrain dips below sea level, the water
 * appears to fill the depression. No physics, no flow, no shoreline
 * smoothing — purely a visual indicator of "below sea level = water".
 *
 * Why an opaque-blue plane and not a refractive shader:
 *   The terrain shader already does its own elevation-tint that goes
 *   blue below y=0, so the depressed terrain is already readable
 *   underneath. The plane just adds a translucent overlay so the
 *   surface plane is visible from oblique angles. Opacity 0.7 keeps
 *   the underwater terrain readable; depthWrite=false lets the terrain
 *   that pokes above y=0 still render correctly without z-fighting.
 *
 * Coordinate alignment:
 *   Like TerrainMesh, we rotate XY → XZ then translate so the SW corner
 *   is at (0, 0). renderOrder=1 ensures opaque terrain draws first so
 *   the translucent water composites over it correctly.
 */

import * as THREE from "three";

export class WaterPlane {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshStandardMaterial;

  constructor(widthM: number, depthM: number) {
    this.geometry = new THREE.PlaneGeometry(widthM, depthM, 1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate(widthM / 2, 0, depthM / 2);
    this.material = new THREE.MeshStandardMaterial({
      color: 0x2a5a9a,
      transparent: true,
      opacity: 0.7,
      roughness: 0.4,
      metalness: 0.2,
      side: THREE.DoubleSide,
      // Allow the terrain to depth-test correctly where it pokes above
      // the water surface — without this we get a z-fight halo on the
      // shoreline.
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = 0.0;
    this.mesh.renderOrder = 1;
    this.mesh.name = "WaterPlane";
    // Water shouldn't intercept the Place / Select tool raycasts —
    // those target the terrain and prefabs respectively.
    this.mesh.raycast = () => undefined;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
