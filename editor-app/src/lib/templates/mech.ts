import * as THREE from 'three';
import type { TemplateDef } from './types';

export const template: TemplateDef = {
  id: 'mech',
  name: 'Mech',
  description: 'A bipedal combat mech with articulated arms and legs.',
  defaultChassisClass: 'ground_legged',

  buildGeometry(): THREE.Group {
    const pivot = new THREE.Group();

    // --- Torso ---
    const torsoGeo = new THREE.BoxGeometry(2.5, 3, 2);
    const torsoMat = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.set(0, 0, 0);
    pivot.add(torso);

    // --- Head ---
    const headGeo = new THREE.BoxGeometry(1.5, 1, 1.5);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, 2.0, 0);
    pivot.add(head);

    // --- Arms (left and right) ---
    const armGeo = () => new THREE.BoxGeometry(0.6, 2.5, 0.6);
    const armMat = () => new THREE.MeshStandardMaterial({ color: 0x6b7280 });

    const leftArm = new THREE.Mesh(armGeo(), armMat());
    leftArm.position.set(-1.75, -0.25, 0);
    pivot.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo(), armMat());
    rightArm.position.set(1.75, -0.25, 0);
    pivot.add(rightArm);

    // --- Legs (two cylinders) ---
    const legGeo = () => new THREE.CylinderGeometry(0.5, 0.5, 2.5, 10);
    const legMat = () => new THREE.MeshStandardMaterial({ color: 0x374151 });

    const leftLeg = new THREE.Mesh(legGeo(), legMat());
    leftLeg.position.set(-0.7, -2.75, 0);
    pivot.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo(), legMat());
    rightLeg.position.set(0.7, -2.75, 0);
    pivot.add(rightLeg);

    // --- Feet ---
    const footGeo = () => new THREE.BoxGeometry(1.2, 0.4, 1.8);
    const footMat = () => new THREE.MeshStandardMaterial({ color: 0x374151 });

    const leftFoot = new THREE.Mesh(footGeo(), footMat());
    leftFoot.position.set(-0.7, -4.2, 0.2);
    pivot.add(leftFoot);

    const rightFoot = new THREE.Mesh(footGeo(), footMat());
    rightFoot.position.set(0.7, -4.2, 0.2);
    pivot.add(rightFoot);

    // Center pivot at origin
    const box = new THREE.Box3().setFromObject(pivot);
    const center = new THREE.Vector3();
    box.getCenter(center);
    pivot.position.set(-center.x, -center.y, -center.z);

    return pivot;
  },
};
