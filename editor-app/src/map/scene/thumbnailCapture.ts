/**
 * Thumbnail capture — renders the current Three.js scene to a square PNG.
 *
 * Used by the project save pipeline (see `../io/projectIo.ts`) to drop a
 * `thumbnail.png` into the project directory alongside the manifest.
 * Future: a recent-projects panel can lazy-load these for previews.
 *
 * Why a fresh offscreen renderer:
 *   The live `MapSceneManager` renderer is sized to the canvas and pixel-
 *   ratio'd to the device. Forcing it to a square 256×256 would clobber
 *   the user's viewport during save. Spinning up a transient renderer is
 *   cheap (~ms on any modern GPU) and isolates side effects.
 *
 * The captured camera is the user's current orbit camera — they framed
 * what they wanted the thumbnail to show by virtue of how they left the
 * viewport.
 */

import * as THREE from "three";

/**
 * Render the current scene to a square PNG via an offscreen renderer.
 *
 * Returns the raw PNG bytes (suitable for shipping to Rust as a `Vec<u8>`).
 *
 * Defensive notes:
 *   - WebGL `readPixels` returns bottom-up rows; we flip to top-down so
 *     the resulting PNG matches the on-screen orientation.
 *   - The transient renderer is disposed before we return so its WebGL
 *     context is released — leaving them around is a known WebGL gotcha
 *     (browsers cap concurrent contexts at ~16).
 */
export function captureThumbnail(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  size = 256,
): Uint8Array {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(1);
  renderer.render(scene, camera);

  const gl = renderer.getContext();
  const pixels = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    renderer.dispose();
    throw new Error("captureThumbnail: 2D context unavailable");
  }
  const imageData = ctx.createImageData(size, size);
  // WebGL pixels are bottom-up; flip per row into the ImageData.
  const rowBytes = size * 4;
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * rowBytes;
    const dstRow = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      imageData.data[dstRow + x] = pixels[srcRow + x];
    }
  }
  ctx.putImageData(imageData, 0, 0);

  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  renderer.dispose();
  return bytes;
}
