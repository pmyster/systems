/**
 * SplatmapTexture — GPU-side wrapper over the store's splatmap bytes.
 *
 * Wraps a single THREE.DataTexture backed by the SAME Uint8Array as the
 * store's `splatmap.data`. Because Three.js holds a reference to the
 * backing buffer (not a copy), every mutation the paint command makes to
 * the bytes is already visible to the GPU on the next upload — we only
 * need to flip `needsUpdate = true` for the new data to be re-uploaded.
 *
 * Today we do a full re-upload per dirty bump (128×128×4 = 64 KB is
 * negligible). The store's `_drainSplatDirty()` returns the touched
 * pixel indices anyway, so a future sub-rect upgrade via gl.texSubImage2D
 * is a localized change here without touching commands or callers.
 */

import * as THREE from "three";

export class SplatmapTexture {
  readonly texture: THREE.DataTexture;

  constructor(widthPx: number, heightPx: number, initialData: Uint8Array) {
    this.texture = new THREE.DataTexture(
      initialData,
      widthPx,
      heightPx,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    // sRGB makes our hand-picked material colors render true under PBR.
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  /**
   * Re-upload the texture. Currently always a full re-upload; can be
   * upgraded to a sub-rect upload by passing dirty bounds later.
   */
  updateRegion(): void {
    this.texture.needsUpdate = true;
  }

  /** Replace the backing data wholesale (load path). */
  replaceData(next: Uint8Array): void {
    this.texture.image.data = next;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
