/**
 * check-sim-purity.mts
 *
 * Greps editor-app/src/sim/*.ts for banned globals that would break determinism.
 * Exits 1 if any are found. Run as part of `npm run check:sim-purity`
 * (and in CI alongside tests).
 *
 * The sim must be byte-deterministic across platforms so that:
 *   - Lockstep multiplayer can stay in sync
 *   - Replays produced on Windows can be played back on Mac/Linux
 *   - Two SimRunners with the same seed + command log produce identical state
 *
 * Anything that reads wall-clock time or system entropy breaks that contract.
 * The only allowed randomness source is the seeded SimRandom (mulberry32) in
 * src/sim/random.ts.
 */

import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BANNED: ReadonlyArray<{ pattern: string; reason: string }> = [
  { pattern: "Date.now", reason: "wall-clock time; use TickContext.tickId instead" },
  { pattern: "performance.now", reason: "wall-clock time; sim is fixed-step on tickId" },
  { pattern: "Math.random", reason: "non-deterministic; use SimRandom.next()" },
  { pattern: "new Date(", reason: "wall-clock time; pass dates in via args if needed" },
];

const SIM_DIR = resolve(__dirname, "../src/sim");

let failures = 0;
const filesScanned: string[] = [];

for (const entry of readdirSync(SIM_DIR, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!entry.name.endsWith(".ts")) continue;
  // Tests can use Date.now / Math.random for setup since they're outside the sim runtime
  if (entry.name.endsWith(".test.ts")) continue;
  // Type declaration shims are fine
  if (entry.name.endsWith(".d.ts")) continue;

  const path = resolve(SIM_DIR, entry.name);
  const src = readFileSync(path, "utf8");
  filesScanned.push(entry.name);

  for (const { pattern, reason } of BANNED) {
    // Look for any occurrence not preceded by a comment marker on the same line
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      const codeBeforeComment = line.split("//")[0];
      if (codeBeforeComment.includes(pattern)) {
        console.error(
          `[sim purity] ${entry.name}:${i + 1} contains forbidden \`${pattern}\` — ${reason}`,
        );
        console.error(`             > ${line.trim()}`);
        failures++;
      }
    }
  }
}

if (filesScanned.length === 0) {
  console.error("[sim purity] No .ts files found in src/sim/ — has the runtime been set up?");
  process.exit(1);
}

if (failures > 0) {
  console.error(
    `\n[sim purity] FAILED — ${failures} violation(s) across ${filesScanned.length} file(s).`,
  );
  process.exit(1);
}

console.log(
  `[sim purity] OK — ${filesScanned.length} file(s) clean: ${filesScanned.join(", ")}`,
);
process.exit(0);
