import * as THREE from 'three';
import type { TemplateDef } from './types';

export const template: TemplateDef = {
  id: 'flyer',
  name: 'Flyer',
  description: 'A fixed-wing aircraft with swept wings and a tapered nose.',
  defaultChassisClass: 'air_fixed_wing',

  buildGeometry(): THREE.Group {
    const pivot = new THREE.Group();

    // --- Fuselage ---
    const fuselageGeo = new THREE.BoxGeometry(1, 1, 6);
    const fuselageMat = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
    fuselage.position.set(0, 0, 0);
    pivot.add(fuselage);

    // --- Wings (left and right, mid-fuselage) ---
    const wingGeo = () => new THREE.BoxGeometry(4, 0.2, 2);
    const wingMat = () => new THREE.MeshStandardMaterial({ color: 0x6b7280 });

    const leftWing = new THREE.Mesh(wingGeo(), wingMat());
    leftWing.position.set(-2.5, 0, 0);
    pivot.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeo(), wingMat());
    rightWing.position.set(2.5, 0, 0);
    pivot.add(rightWing);

    // --- Tail fin ---
    const tailFinGeo = new THREE.BoxGeometry(0.2, 1.5, 1);
    const tailFinMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 });
    const tailFin = new THREE.Mesh(tailFinGeo, tailFinMat);
    tailFin.position.set(0, 0.85, -2.5);
    pivot.add(tailFin);

    // --- Nose cone ---
    const noseConeGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const noseConeMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 });
    const noseCone = new THREE.Mesh(noseConeGeo, noseConeMat);
    noseCone.position.set(0, 0, 3.4);
    pivot.add(noseCone);

    // --- Engine exhausts ---
    const exhaustGeo = () => new THREE.BoxGeometry(0.4, 0.4, 0.5);
    const exhaustMat = () => new THREE.MeshStandardMaterial({ color: 0xe07050 });

    const leftExhaust = new THREE.Mesh(exhaustGeo(), exhaustMat());
    leftExhaust.position.set(-0.4, -0.2, -3.1);
    pivot.add(leftExhaust);

    const rightExhaust = new THREE.Mesh(exhaustGeo(), exhaustMat());
    rightExhaust.position.set(0.4, -0.2, -3.1);
    pivot.add(rightExhaust);

    // Center pivot at origin
    const box = new THREE.Box3().setFromObject(pivot);
    const center = new THREE.Vector3();
    box.getCenter(center);
    pivot.position.set(-center.x, -center.y, -center.z);

    return pivot;
  },
};
