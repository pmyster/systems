import * as THREE from 'three';
import type { TemplateDef } from './types';

export const template: TemplateDef = {
  id: 'naval',
  name: 'Naval Vessel',
  description: 'A surface warship with a box hull, superstructure, and funnel.',
  defaultChassisClass: 'naval_surface',

  buildGeometry(): THREE.Group {
    const pivot = new THREE.Group();

    // --- Hull ---
    const hullGeo = new THREE.BoxGeometry(7, 1, 4);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.set(0, 0, 0);
    pivot.add(hull);

    // --- Superstructure ---
    const superGeo = new THREE.BoxGeometry(3, 2, 2);
    const superMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 });
    const superstructure = new THREE.Mesh(superGeo, superMat);
    superstructure.position.set(0, 1.5, 0);
    pivot.add(superstructure);

    // --- Funnel ---
    const funnelGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.5, 10);
    const funnelMat = new THREE.MeshStandardMaterial({ color: 0xe07050 });
    const funnel = new THREE.Mesh(funnelGeo, funnelMat);
    funnel.position.set(0, 3.25, 0);
    pivot.add(funnel);

    // --- Bow accent strip ---
    const bowGeo = new THREE.BoxGeometry(0.3, 0.5, 3.8);
    const bowMat = new THREE.MeshStandardMaterial({ color: 0xc9a55c });
    const bow = new THREE.Mesh(bowGeo, bowMat);
    bow.position.set(3.4, 0.3, 0);
    pivot.add(bow);

    // Center pivot at origin
    const box = new THREE.Box3().setFromObject(pivot);
    const center = new THREE.Vector3();
    box.getCenter(center);
    pivot.position.set(-center.x, -center.y, -center.z);

    return pivot;
  },
};
