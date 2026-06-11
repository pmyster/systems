/**
 * Vitest config — mirrors the existing tsconfig.json's bundler module mode,
 * so imports like "../coords/constants" work without extension glue.
 *
 * Conventions:
 *   - environment: jsdom (DOM-touching code is allowed; pure-math tests pay
 *     a tiny startup cost but get a uniform runtime).
 *   - globals: false — every test file imports `describe`, `it`, `expect`
 *     explicitly. Easier to grep, no hidden globals.
 *   - include: only `*.test.ts(x)` so we don't pick up scripts under
 *     `scripts/` or the Tauri-side Rust integration tests.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Allow tests to import fixture content (unit schematics) from the
  // repo-level `units/` directory one level above editor-app/. Vite's
  // default fs.strict gate would otherwise deny these imports with
  // "Denied ID" because they fall outside the editor-app workspace
  // root. The directories listed here are READ-ONLY fixture sources;
  // tests never write to them.
  server: {
    fs: {
      allow: ["..", "../units"],
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
