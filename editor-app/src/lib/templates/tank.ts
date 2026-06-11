import * as THREE from 'three';
import type { TemplateDef } from './types';

export const template: TemplateDef = {
  id: 'tank',
  name: 'Tank',
  description: 'A heavy ground unit with thick armour, a rotating turret, and road wheels.',
  defaultChassisClass: 'ground_tracked',

  buildGeometry(): THREE.Group {
    const pivot = new THREE.Group();

    // --- Hull ---
    const hullGeo = new THREE.BoxGeometry(6, 1.5, 4);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.set(0, 0, 0);
    pivot.add(hull);

    // --- Turret (offset slightly forward) ---
    const turretGeo = new THREE.BoxGeometry(2, 1, 2);
    const turretMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 });
    const turret = new THREE.Mesh(turretGeo, turretMat);
    turret.position.set(0.5, 1.25, 0);
    pivot.add(turret);

    // --- Road wheels — 4 cylinders, two per side ---
    const wheelGeo = () => new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12);
    const wheelMat = () => new THREE.MeshStandardMaterial({ color: 0x374151 });

    const wheelPositions: [number, number, number][] = [
      [-1.5, -0.9, -2.0],
      [ 1.5, -0.9, -2.0],
      [-1.5, -0.9,  2.0],
      [ 1.5, -0.9,  2.0],
    ];

    for (const [wx, wy, wz] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo(), wheelMat());
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
