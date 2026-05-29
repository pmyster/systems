/**
 * Smoke test — build every template's geometry and run the voxelizer on it.
 * Pure CPU math (no WebGL), so it runs headless under tsx.
 *
 * Verifies: templates produce geometry, voxelizeMesh traverses + fills cells,
 * voxelMapToGrid serializes without throwing.
 *
 * Run: npx tsx scripts/smoke-voxelize.mts
 */
import { TEMPLATES } from "../src/lib/templates";
import { voxelizeMesh, voxelMapToGrid } from "../src/lib/voxelizer";

let pass = 0;
let fail = 0;

for (const t of TEMPLATES) {
  try {
    const group = t.buildGeometry();
    const voxels = voxelizeMesh(group);
    const grid = voxelMapToGrid(voxels);
    if (voxels.size === 0) {
      fail++;
      console.log(`  FAIL ${t.name.padEnd(20)} voxelizer produced 0 cells`);
    } else {
      pass++;
      console.log(`  ok   ${t.name.padEnd(20)} ${voxels.size} cells  grid=${grid?.format ?? "?"}`);
    }
  } catch (e) {
    fail++;
    console.log(`  FAIL ${t.name.padEnd(20)} threw: ${(e as Error).message}`);
  }
}

console.log(`\n${pass}/${TEMPLATES.length} templates voxelize cleanly; ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
