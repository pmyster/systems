/**
 * Barrel for the BattlefieldPreview component.
 *
 * Only the public component is re-exported. Internal modules
 * (scene.ts, terrain.ts, lighting.ts, controls.ts, unit-on-terrain.ts)
 * are implementation details and should not be imported from outside
 * this directory.
 */

export { BattlefieldPreview } from "./BattlefieldPreview";
