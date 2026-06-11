/**
 * Smoke test — exercise the pure material-ops over a known voxel map.
 * Pure CPU math (no WebGL), so it runs headless under tsx.
 *
 * Builds a solid 4x4x4 block of "hull" (64 cells, spanning 0..3 on each
 * axis) and asserts the documented behavior of each material-op.
 *
 * Run: npx tsx scripts/smoke-material-ops.mts
 */
import type { MaterialId, MutableVoxelMap } from "../src/types/voxel";
import {
  paintBrush,
  floodFill,
  assignShellCore,
  assignHeightBands,
  swapMaterial,
} from "../src/lib/material-ops";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
  }
}

/** Count how many cells differ in material between two maps. */
function diffCount(a: MutableVoxelMap, b: MutableVoxelMap): number {
  let n = 0;
  for (const [key, mat] of b) {
    if (a.get(key) !== mat) n++;
  }
  return n;
}

/** Count cells set to a given material. */
function countMat(m: MutableVoxelMap, mat: MaterialId): number {
  let n = 0;
  for (const v of m.values()) if (v === mat) n++;
  return n;
}

// Build a solid 4x4x4 block of "hull": coords 0..3 on each axis => 64 cells.
const block: MutableVoxelMap = new Map();
for (let x = 0; x < 4; x++) {
  for (let y = 0; y < 4; y++) {
    for (let z = 0; z < 4; z++) {
      block.set(`${x},${y},${z}`, "hull");
    }
  }
}

check("block has 64 cells", block.size === 64);

// --- paintBrush ------------------------------------------------------------
{
  const b1 = paintBrush(block, 1, 1, 1, "armor", 1);
  check("paintBrush size 1 changes exactly 1 cell", diffCount(block, b1) === 1);
  check("paintBrush size 1 does not mutate input", countMat(block, "armor") === 0);

  // Center (1,1,1) with radius 1 => 3x3x3 = 27 cells, all inside the 0..3 block.
  const b2 = paintBrush(block, 1, 1, 1, "armor", 2);
  check("paintBrush size 2 at interior center changes 27 cells", diffCount(block, b2) === 27);

  // Corner (0,0,0) with radius 1 => half the neighbors are off-block.
  const bCorner = paintBrush(block, 0, 0, 0, "armor", 2);
  const cornerChanged = diffCount(block, bCorner);
  check(
    `paintBrush size 2 at corner changes <=27 (got ${cornerChanged})`,
    cornerChanged <= 27 && cornerChanged === 8,
  );
}

// --- floodFill -------------------------------------------------------------
{
  const f = floodFill(block, 2, 2, 2, "armor");
  check("floodFill over uniform block repaints all 64", countMat(f, "armor") === 64);
  check("floodFill does not mutate input", countMat(block, "armor") === 0);

  // Start cell missing => unchanged copy.
  const fMiss = floodFill(block, 99, 99, 99, "armor");
  check("floodFill from missing start is unchanged", diffCount(block, fMiss) === 0 && fMiss.size === 64);
}

// --- assignShellCore -------------------------------------------------------
{
  const sc = assignShellCore(block, "armor", "engine");
  // Interior 2x2x2 (coords 1..2 each axis) = 8 core; remaining 56 = shell.
  check("assignShellCore: core count === 8", countMat(sc, "engine") === 8);
  check("assignShellCore: shell count === 56", countMat(sc, "armor") === 56);
  check("assignShellCore preserves cell count", sc.size === 64);
}

// --- assignHeightBands -----------------------------------------------------
{
  const bands: readonly MaterialId[] = ["armor", "hull", "accent", "engine"];
  const hb = assignHeightBands(block, bands);
  // y spans 0..3, 4 bands => each y-layer (16 cells) maps to one band.
  check("assignHeightBands: band armor has 16", countMat(hb, "armor") === 16);
  check("assignHeightBands: band hull has 16", countMat(hb, "hull") === 16);
  check("assignHeightBands: band accent has 16", countMat(hb, "accent") === 16);
  check("assignHeightBands: band engine has 16", countMat(hb, "engine") === 16);

  // Empty bands => unchanged copy.
  const hbEmpty = assignHeightBands(block, []);
  check("assignHeightBands empty bands is unchanged", diffCount(block, hbEmpty) === 0);
}

// --- swapMaterial ----------------------------------------------------------
{
  const sw = swapMaterial(block, "hull", "armor");
  check("swapMaterial hull->armor changes all 64", countMat(sw, "armor") === 64);
  check("swapMaterial does not mutate input", countMat(block, "hull") === 64);

  // Absent `from` => fresh, unchanged copy.
  const swNoop = swapMaterial(block, "glass", "armor");
  check("swapMaterial absent from is unchanged copy", diffCount(block, swNoop) === 0 && swNoop !== block);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
