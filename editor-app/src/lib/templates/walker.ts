import * as THREE from 'three';
import type { TemplateDef } from './types';

export const template: TemplateDef = {
  id: 'walker',
  name: 'Walker',
  description: 'A six-legged insectoid walker with a sensor dome on top.',
  defaultChassisClass: 'walker_fusion',

  buildGeometry(): THREE.Group {
    const pivot = new THREE.Group();

    // --- Body ---
    const bodyGeo = new THREE.BoxGeometry(3, 2, 3);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0, 0);
    pivot.add(body);

    // --- Sensor head (sphere) ---
    const sensorGeo = new THREE.SphereGeometry(0.8, 12, 8);
    const sensorMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 });
    const sensor = new THREE.Mesh(sensorGeo, sensorMat);
    sensor.position.set(0, 1.8, 0);
    pivot.add(sensor);

    // --- 6 legs, 3 per side, angled outward 15° ---
    const legAngleRad = 15 * (Math.PI / 180);
    // Z offsets for the 3 legs along each side
    const legZOffsets = [-1.0, 0.0, 1.0];

    for (const side of [-1, 1] as const) {
      for (const zOffset of legZOffsets) {
        const legGeo = new THREE.CylinderGeometry(0.2, 0.2, 2.5, 8);
        const legMat = new THREE.MeshStandardMaterial({ color: 0x374151 });
        const leg = new THREE.Mesh(legGeo, legMat);

        // Tilt outward from the body
        leg.rotation.z = side * legAngleRad;
        // Position: out to the side, down from the body, along Z
        leg.position.set(
          side * (1.5 + Math.sin(legAngleRad) * 1.25),
          -1.0 - Math.cos(legAngleRad) * 0.5,
          zOffset,
        );
        pivot.add(leg);
      }
    }

    // Center pivot at origin
    const box = new THREE.Box3().setFromObject(pivot);
    const center = new THREE.Vector3();
    box.getCenter(center);
    pivot.position.set(-center.x, -center.y, -center.z);

    return pivot;
  },
};
