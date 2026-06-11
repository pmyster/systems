import * as THREE from 'three';
import type { TemplateDef } from './types';

export const template: TemplateDef = {
  id: 'defense-structure',
  name: 'Defense Structure',
  description: 'A static gun emplacement with a wide base, central tower, and forward-facing barrel.',
  defaultChassisClass: 'static_structure',

  buildGeometry(): THREE.Group {
    const pivot = new THREE.Group();

    // --- Base ---
    const baseGeo = new THREE.BoxGeometry(5, 0.5, 5);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, 0, 0);
    pivot.add(base);

    // --- Tower ---
    const towerGeo = new THREE.BoxGeometry(1.5, 4, 1.5);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 });
    const tower = new THREE.Mesh(towerGeo, towerMat);
    tower.position.set(0, 2.25, 0);
    pivot.add(tower);

    // --- Gun mount on top of tower ---
    const mountGeo = new THREE.BoxGeometry(1, 0.8, 2);
    const mountMat = new THREE.MeshStandardMaterial({ color: 0x374151 });
    const mount = new THREE.Mesh(mountGeo, mountMat);
    mount.position.set(0, 4.65, 0.5);
    pivot.add(mount);

    // --- Barrel — horizontal, pointing forward (positive Z) ---
    const barrelGeo = new THREE.CylinderGeometry(0.2, 0.2, 2, 10);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x374151 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2; // rotate so barrel points along Z
    barrel.position.set(0, 4.65, 1.5 + 1); // tip sits forward of the mount
    pivot.add(barrel);

    // --- Accent ring on tower ---
    const accentGeo = new THREE.BoxGeometry(1.7, 0.2, 1.7);
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xc9a55c });
    const accent = new THREE.Mesh(accentGeo, accentMat);
    accent.position.set(0, 3.5, 0);
    pivot.add(accent);

    // Center pivot at origin
    const box = new THREE.Box3().setFromObject(pivot);
    const center = new THREE.Vector3();
    box.getCenter(center);
    pivot.position.set(-center.x, -center.y, -center.z);

    return pivot;
  },
};
