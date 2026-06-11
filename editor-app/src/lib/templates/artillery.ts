import * as THREE from 'three';
import type { TemplateDef } from './types';

export const template: TemplateDef = {
  id: 'artillery',
  name: 'Artillery',
  description: 'A long-range artillery unit with an elevated barrel angled for maximum range.',
  defaultChassisClass: 'ground_tracked',

  buildGeometry(): THREE.Group {
    const pivot = new THREE.Group();

    // --- Chassis ---
    const chassisGeo = new THREE.BoxGeometry(5, 1, 4);
    const chassisMat = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.set(0, 0, 0);
    pivot.add(chassis);

    // --- Gun platform ---
    const platformGeo = new THREE.BoxGeometry(2, 1.5, 2);
    const platformMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.set(0, 1.25, 0);
    pivot.add(platform);

    // --- Barrel — angled upward 35° ---
    const barrelAngle = 35 * (Math.PI / 180);
    const barrelLength = 5;
    const barrelGeo = new THREE.CylinderGeometry(0.25, 0.25, barrelLength, 10);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x374151 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    // Rotate around X so the barrel points forward and up
    barrel.rotation.x = -barrelAngle;
    // Offset so the base of the barrel sits on the platform
    barrel.position.set(
      0,
      2.0 + (barrelLength / 2) * Math.sin(barrelAngle),
      -(barrelLength / 2) * Math.cos(barrelAngle),
    );
    pivot.add(barrel);

    // --- Road wheels (same pattern as tank) ---
    const wheelPositions: [number, number, number][] = [
      [-1.5, -0.65, -1.5],
      [ 1.5, -0.65, -1.5],
      [-1.5, -0.65,  1.5],
      [ 1.5, -0.65,  1.5],
    ];

    for (const [wx, wy, wz] of wheelPositions) {
      const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x374151 });
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, wy, wz);
      pivot.add(wheel);
    }

    // Center pivot at origin
    const box = new THREE.Box3().setFromObject(pivot);
    const center = new THREE.Vector3();
    box.getCenter(center);
    pivot.position.set(-center.x, -center.y, -center.z);

    return pivot;
  },
};
