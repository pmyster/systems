/**
 * Heightmap codec — Float32Array ⇄ raw little-endian byte buffer.
 *
 * The on-disk `.r32` sidecar (see ADR 0002) is platform-agnostic:
 * `widthPx * heightPx` little-endian Float32 values, no header. The
 * browser's Float32Array uses **host** endianness, which on every
 * shipping x86/ARM is LE — but we cannot rely on that for portability,
 * so we force LE explicitly via DataView. Round-trip is byte-identical.
 *
 * Tauri serializes Rust's `Vec<u8>` as a JS `number[]`; callers wrap it
 * in `Uint8Array(bytes)` before calling `decodeHeightmap`.
 */

/** Float32Array → little-endian Uint8Array for raw .r32 storage. */
export function encodeHeightmap(heightmap: Float32Array): Uint8Array {
  const out = new Uint8Array(heightmap.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < heightmap.length; i++) {
    view.setFloat32(i * 4, heightmap[i], true);
  }
  return out;
}

/** Uint8Array → Float32Array (little-endian decode). */
export function decodeHeightmap(
  bytes: Uint8Array,
  widthPx: number,
  heightPx: number,
): Float32Array {
  const expected = widthPx * heightPx * 4;
  if (bytes.length !== expected) {
    throw new Error(
      `heightmap byte length ${bytes.length} != expected ${expected} ` +
        `(${widthPx}x${heightPx} * 4)`,
    );
  }
  const out = new Float32Array(widthPx * heightPx);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getFloat32(i * 4, true);
  }
  return out;
}
