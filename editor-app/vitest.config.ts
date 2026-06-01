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
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
