/**
 * Brush footprint iterator: walk every pixel within a disc on the
 * heightmap grid, invoking a callback with a Gaussian-falloff weight.
 *
 * Convention notes:
 *   - `cx`, `cy` are fractional pixel coordinates (use `worldToHeightmap`
 *     upstream to get them).
 *   - `radiusPx` is the disc radius in pixels (NOT meters; callers must
 *     convert via HEIGHTMAP_M_PER_PIXEL).
 *   - Weight is `exp(-((d/radius)^2) * sharpness)` clamped to [0, 1],
 *     ≈ 1 at center, ≈ 0 at radius. A sharpness factor of 4 means weight
 *     drops to ~0.018 at the edge, which feels like a "soft" brush — the
 *     Day 3 brush panel will expose this.
 *   - Pixels OUTSIDE the grid are skipped silently (no negative indexing,
 *     no out-of-bounds writes — the caller can drag the brush off the
 *     map without crashing).
 *
 * Performance:
 *   This is the hottest path in the sculpt tool. We pre-square the
 *   radius and avoid sqrt in the common-case rejection test.
 */

const GAUSSIAN_SHARPNESS = 4;

export function forEachPixelInDisc(
  cx: number,
  cy: number,
  radiusPx: number,
  widthPx: number,
  heightPx: number,
  cb: (idx: number, weight: number) => void,
): void {
  if (radiusPx <= 0) return;
  const r = radiusPx;
  const r2 = r * r;
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(widthPx - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(heightPx - 1, Math.ceil(cy + r));

  for (let py = minY; py <= maxY; py++) {
    const dy = py - cy;
    const dy2 = dy * dy;
    const rowBase = py * widthPx;
    for (let px = minX; px <= maxX; px++) {
      const dx = px - cx;
      const d2 = dx * dx + dy2;
      if (d2 > r2) continue;
      // Gaussian falloff with bounded sharpness so the brush has a soft edge.
      const t = d2 / r2;
      const weight = Math.exp(-t * GAUSSIAN_SHARPNESS);
      cb(rowBase + px, weight);
    }
  }
}
