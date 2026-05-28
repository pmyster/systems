import * as THREE from 'three';
import type { TemplateDef } from './types';

export const template: TemplateDef = {
  id: 'carrier',
  name: 'Carrier / Transport',
  description: 'A large naval carrier with a flat flight deck, island bridge, and twin funnels.',
  defaultChassisClass: 'naval_surface',

  buildGeometry(): THREE.Group {
    const pivot = new THREE.Group();

    // --- Flight deck ---
    const deckGeo = new THREE.BoxGeometry(10, 0.8, 6);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(0, 0, 0);
    pivot.add(deck);

    // --- Island / bridge (starboard side = positive Z) ---
    const bridgeGeo = new THREE.BoxGeometry(2, 3, 2);
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x4b5563 });
    const bridge = new THREE.Mesh(bridgeGeo, bridgeMat);
    bridge.position.set(0, 2.0, 2.2);
    pivot.add(bridge);

    // --- Twin funnels on the bridge ---
    const funnelPositions: [number, number, number][] = [
      [-0.4, 3.8, 2.2],
      [ 0.4, 3.8, 2.2],
    ];

    for (const [fx, fy, fz] of funnelPositions) {
      const funnelGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.2, 10);
      const funnelMat = new THREE.MeshStandardMaterial({ color: 0xe07050 });
      const funnel = new THREE.Mesh(funnelGeo, funnelMat);
      funnel.position.set(fx, fy, fz);
      pivot.add(funnel);
    }

    // --- Hangar opening suggestion (front, slightly darker box) ---
    const hangarGeo = new THREE.BoxGeometry(3, 1.5, 1);
    const hangarMat = new THREE.MeshStandardMaterial({ color: 0x374151 });
    const hangar = new THREE.Mesh(hangarGeo, hangarMat);
    hangar.position.set(0, 0.55, -2.5);
    pivot.add(hangar);

    // --- Deck accent stripe ---
    const stripeGeo = new THREE.BoxGeometry(9.5, 0.05, 0.3);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc9a55c });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(0, 0.43, 0);
    pivot.add(stripe);

    // Center pivot at origin
    const box = new THREE.Box3().setFromObject(pivot);
    const center = new THREE.Vector3();
    box.getCenter(center);
    pivot.position.set(-center.x, -center.y, -center.z);

    return pivot;
  },
};
