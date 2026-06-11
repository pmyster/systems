import * as THREE from 'three';
import type { TemplateDef } from './types';

export const template: TemplateDef = {
  id: 'scout',
  name: 'Scout',
  description: 'A fast, lightweight wheeled scout with a tall sensor mast.',
  defaultChassisClass: 'ground_wheeled',

  buildGeometry(): THREE.Group {
    const pivot = new THREE.Group();

    // --- Chassis ---
    const chassisGeo = new THREE.BoxGeometry(3, 0.8, 2);
    const chassisMat = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.set(0, 0, 0);
    pivot.add(chassis);

    // --- 4 sphere wheels at corners ---
    const wheelRadius = 0.4;
    const wheelOffsets: [number, number, number][] = [
      [-1.2, -0.45, -0.8],
      [ 1.2, -0.45, -0.8],
      [-1.2, -0.45,  0.8],
      [ 1.2, -0.45,  0.8],
    ];

    for (const [wx, wy, wz] of wheelOffsets) {
      const wheelGeo = new THREE.SphereGeometry(wheelRadius, 10, 8);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x374151 });
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wx, wy, wz);
      pivot.add(wheel);
    }

    // --- Sensor mast ---
    const mastGeo = new THREE.BoxGeometry(0.2, 1.5, 0.2);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0xc9a55c });
    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.set(0, 1.15, 0);
    pivot.add(mast);

    // --- Sensor head at top of mast ---
    const sensorHeadGeo = new THREE.BoxGeometry(0.5, 0.4, 0.5);
    const sensorHeadMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 });
    const sensorHead = new THREE.Mesh(sensorHeadGeo, sensorHeadMat);
    sensorHead.position.set(0, 2.1, 0);
    pivot.add(sensorHead);

    // Center pivot at origin
    const box = new THREE.Box3().setFromObject(pivot);
    const center = new THREE.Vector3();
    box.getCenter(center);
    pivot.position.set(-center.x, -center.y, -center.z);

    return pivot;
  },
};
