import { describe, it, expect } from "vitest";

import { decodeHeightmap, encodeHeightmap } from "./heightmapCodec";

describe("heightmapCodec", () => {
  it("round-trips an empty heightmap byte-identical", () => {
    const original = new Float32Array(4 * 4); // all zeros
    const bytes = encodeHeightmap(original);
    expect(bytes.length).toBe(64);
    const round = decodeHeightmap(bytes, 4, 4);
    expect(round).toEqual(original);
  });

  it("round-trips arbitrary Float32 values byte-identical", () => {
    const original = new Float32Array([
      0, 1, -1, 0.5, -0.5, 1e-7, 1e7, Math.PI, Math.E, Number.MIN_VALUE,
      Number.MAX_VALUE / 1e30, -42.42, 100.0001, 0.0001, 12345.6789, -98765.4321,
    ]);
    const bytes = encodeHeightmap(original);
    const round = decodeHeightmap(bytes, 4, 4);
    expect(round.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      // Float32 round-trip: exactly equal, NOT epsilon — the encoder
      // wrote the same Float32 bit pattern the decoder reads back.
      expect(round[i]).toBe(original[i]);
    }
  });

  it("encodes as little-endian regardless of platform", () => {
    const arr = new Float32Array([1.0]);
    const bytes = encodeHeightmap(arr);
    // IEEE-754 binary32 for 1.0 = 0x3F800000.
    // LE byte order: 00 00 80 3F
    expect(bytes[0]).toBe(0x00);
    expect(bytes[1]).toBe(0x00);
    expect(bytes[2]).toBe(0x80);
    expect(bytes[3]).toBe(0x3f);
  });

  it("decodes the canonical LE encoding of 1.0", () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x80, 0x3f]);
    const out = decodeHeightmap(bytes, 1, 1);
    expect(out[0]).toBe(1.0);
  });

  it("throws when byte length does not match widthPx*heightPx*4", () => {
    const bytes = new Uint8Array(60); // expects 64
    expect(() => decodeHeightmap(bytes, 4, 4)).toThrow(/byte length/);
  });

  it("round-trips a 129x129 default-sized heightmap with a sculpted bump", () => {
    const w = 129;
    const h = 129;
    const original = new Float32Array(w * h);
    // Carve a recognizable signal: gaussian-ish bump near center.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - 64;
        const dy = y - 64;
        const d2 = dx * dx + dy * dy;
        original[y * w + x] = Math.exp(-d2 / 200) * 3.5 - 0.1;
      }
    }
    const bytes = encodeHeightmap(original);
    expect(bytes.length).toBe(w * h * 4);
    const round = decodeHeightmap(bytes, w, h);
    for (let i = 0; i < original.length; i++) {
      expect(round[i]).toBe(original[i]);
    }
  });
});
