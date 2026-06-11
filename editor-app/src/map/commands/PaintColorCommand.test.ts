/**
 * Vitest coverage for PaintColorCommand.
 *
 * Coverage:
 *   - do() sets RGB to the target color and raises opacity inside the disc.
 *   - undo() restores the exact pre-paint bytes.
 *   - merge() collapses same-color same-mode consecutive ticks.
 *   - merge() refuses cross-color ticks.
 *   - eraseMode reduces opacity and zeroes RGB when opacity hits 0.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { _resetMapStore, useMapStore } from "../state/mapStore";

import { PaintColorCommand } from "./PaintColorCommand";

describe("PaintColorCommand", () => {
  beforeEach(() => {
    _resetMapStore();
  });

  it("do() sets RGB to the target color and raises opacity inside the disc", () => {
    const state = useMapStore.getState();
    const w = state.colorPaint.widthPx;
    const cx = Math.floor(w / 2);
    const cy = Math.floor(state.colorPaint.heightPx / 2);
    const centerIdx = (cy * w + cx) * 4;
    // Buffer starts at all zeros — no painted color anywhere.
    expect(state.colorPaint.data[centerIdx + 3]).toBe(0);

    new PaintColorCommand({
      centerPxX: cx,
      centerPxY: cy,
      radiusPx: 4,
      strength: 1,
      color: { r: 255, g: 80, b: 30 },
      eraseMode: false,
    }).do();

    const after = useMapStore.getState().colorPaint.data;
    expect(after[centerIdx + 0]).toBe(255);
    expect(after[centerIdx + 1]).toBe(80);
    expect(after[centerIdx + 2]).toBe(30);
    expect(after[centerIdx + 3]).toBeGreaterThan(0);
  });

  it("undo() restores the exact pre-paint bytes", () => {
    const state = useMapStore.getState();
    const beforeSnapshot = new Uint8Array(state.colorPaint.data);
    const cmd = new PaintColorCommand({
      centerPxX: 10,
      centerPxY: 10,
      radiusPx: 3,
      strength: 0.5,
      color: { r: 100, g: 200, b: 50 },
      eraseMode: false,
    });
    cmd.do();
    cmd.undo();
    const after = useMapStore.getState().colorPaint.data;
    expect(Array.from(after)).toEqual(Array.from(beforeSnapshot));
  });

  it("merge() collapses two same-color same-mode ticks", () => {
    const color = { r: 50, g: 100, b: 200 };
    const cmdA = new PaintColorCommand({
      centerPxX: 5,
      centerPxY: 5,
      radiusPx: 2,
      strength: 0.4,
      color,
      eraseMode: false,
    });
    const cmdB = new PaintColorCommand({
      centerPxX: 6,
      centerPxY: 5,
      radiusPx: 2,
      strength: 0.4,
      color,
      eraseMode: false,
    });
    cmdA.do();
    cmdB.do();
    const merged = cmdA.merge?.(cmdB);
    expect(merged).toBe(true);
    cmdA.undo();
    // Buffer should be back to all-zero default.
    const restored = useMapStore.getState().colorPaint.data;
    for (let i = 0; i < restored.length; i++) {
      expect(restored[i]).toBe(0);
    }
  });

  it("merge() refuses cross-color ticks", () => {
    const cmdA = new PaintColorCommand({
      centerPxX: 5,
      centerPxY: 5,
      radiusPx: 2,
      strength: 0.4,
      color: { r: 255, g: 0, b: 0 },
      eraseMode: false,
    });
    const cmdB = new PaintColorCommand({
      centerPxX: 5,
      centerPxY: 5,
      radiusPx: 2,
      strength: 0.4,
      color: { r: 0, g: 255, b: 0 },
      eraseMode: false,
    });
    expect(cmdA.merge?.(cmdB)).toBe(false);
  });

  it("eraseMode reduces opacity and zeroes RGB when fully erased", () => {
    // Pre-paint a pixel via direct buffer mutation (this is a test
    // helper — production code goes through commands).
    const state = useMapStore.getState();
    const cp = state.colorPaint.data;
    const w = state.colorPaint.widthPx;
    const cx = 20;
    const cy = 20;
    const base = (cy * w + cx) * 4;
    cp[base + 0] = 200;
    cp[base + 1] = 100;
    cp[base + 2] = 50;
    cp[base + 3] = 200;

    new PaintColorCommand({
      centerPxX: cx,
      centerPxY: cy,
      radiusPx: 1,
      strength: 1,
      color: { r: 0, g: 0, b: 0 },
      eraseMode: true,
    }).do();

    const after = useMapStore.getState().colorPaint.data;
    // Strength 1 + gaussian weight 1 at center → 255 opacity reduction
    // → clamped to 0. RGB should follow to zero.
    expect(after[base + 3]).toBe(0);
    expect(after[base + 0]).toBe(0);
    expect(after[base + 1]).toBe(0);
    expect(after[base + 2]).toBe(0);
  });
});
