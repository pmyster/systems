/**
 * ColorPaintTexture — GPU wrapper over the store's color-paint bytes.
 *
 * Mirrors SplatmapTexture: a single THREE.DataTexture backed by the same
 * Uint8Array as `mapStore.colorPaint.data`. The terrain shader samples
 * this texture to apply an arbitrary RGBA tint overlay on top of the
 * material+atmosphere blend. RGB carries the painted color, A carries
 * the overlay opacity. Default = all zeros (no tint anywhere).
 *
 * Today we do a full re-upload per dirty bump (128×128×4 = 64 KB is
 * negligible). The store's `_drainColorPaintDirty()` returns the touched
 * pixel indices so a future sub-rect upgrade via gl.texSubImage2D is a
 * localised change here without touching commands or callers.
 */

import * as THREE from "three";

export class ColorPaintTexture {
  readonly texture: THREE.DataTexture;

  constructor(widthPx: number, heightPx: number, initialData: Uint8Array) {
    this.texture = new THREE.DataTexture(
      initialData,
      widthPx,
      heightPx,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    // We treat the painted color as authoring-space RGB and want it
    // mixed in the shader without an extra sRGB→linear conversion (the
    // tint math is already authored "as drawn"). NoColorSpace matches
    // how SplatmapTexture handles its weights for the same reason.
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  /**
   * Re-upload the texture. Currently always a full re-upload; the dirty
   * indices flow through `_drainColorPaintDirty` so a sub-rect upgrade
   * is straightforward when needed.
   */
  updateRegion(): void {
    this.texture.needsUpdate = true;
  }

  /** Replace the backing data wholesale (load path / new map). */
  replaceData(next: Uint8Array): void {
    this.texture.image.data = next;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
