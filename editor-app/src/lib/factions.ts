/**
 * Canonical faction color palettes.
 *
 * Lifted verbatim from tools/battlefield-viewer/index.html lines 177-188.
 * Colors are 24-bit integers (Three.js-native). For CSS, use the
 * hexString() helper or the FACTION_PALETTE_HEX mirror at the bottom.
 *
 * Faction IDs match the enum in schemas/unit.schema.json — the four
 * core factions plus Neutral and the V2+ Returner factions named in
 * DESIGN.md and docs/factions.md.
 */

import type { Faction } from "../types/unit";

/** A faction's three-color palette. Values are 24-bit RGB integers. */
export interface FactionPalette {
  /** Primary chassis / armor color. */
  readonly primary: number;
  /** Hull / framing color. */
  readonly secondary: number;
  /** Highlight / trim color. */
  readonly accent: number;
}

/**
 * The full palette table. Every Faction in unit.schema.json's enum
 * appears here so renderers can index without a fallback dance.
 */
export const FACTION_PALETTES: Readonly<Record<Faction, FactionPalette>> = Object.freeze({
  reclaimer:    { primary: 0xc9a55c, secondary: 0x8b6e3a, accent: 0xe5c890 },
  bulwark:      { primary: 0x90969c, secondary: 0x5a5e64, accent: 0xb8bec4 },
  signal:       { primary: 0x6b9eb3, secondary: 0x3a5b6e, accent: 0x9bc3d4 },
  cinder_crown: { primary: 0xc16060, secondary: 0x7a2828, accent: 0xe09090 },
  neutral:      { primary: 0xa0a0a0, secondary: 0x707070, accent: 0xc0c0c0 },
  tethered:     { primary: 0x8eb4c9, secondary: 0x5e84a0, accent: 0xb8d0e0 },
  quiet_court:  { primary: 0x9b7eb3, secondary: 0x6b4e80, accent: 0xc0a0d0 },
  burnward:     { primary: 0x8b3a3a, secondary: 0x551818, accent: 0xb8585b },
  drifters:     { primary: 0xc0c0c0, secondary: 0x808080, accent: 0xe0e0e0 },
  veiled:       { primary: 0x553a6b, secondary: 0x2a1a40, accent: 0x7858a0 },
});

/**
 * Fallback palette for code paths that get a missing or invalid
 * faction id. Matches the prototype's behavior of falling back to
 * neutral.
 */
export const DEFAULT_FACTION: Faction = "neutral";

/**
 * Safe accessor — guarantees a palette even if the caller hands in
 * something unexpected (e.g. an unsaved unit with no faction yet).
 */
export function getFactionPalette(faction: Faction | undefined | null): FactionPalette {
  if (faction != null && faction in FACTION_PALETTES) {
    return FACTION_PALETTES[faction];
  }
  return FACTION_PALETTES[DEFAULT_FACTION];
}

/** Convert a 24-bit int color to a 6-digit '#rrggbb' string. */
export function hexString(color: number): string {
  return "#" + color.toString(16).padStart(6, "0");
}

/** Mirror of FACTION_PALETTES with hex-string colors (handy for CSS / UI). */
export const FACTION_PALETTE_HEX: Readonly<
  Record<Faction, { readonly primary: string; readonly secondary: string; readonly accent: string }>
> = Object.freeze(
  (Object.keys(FACTION_PALETTES) as Faction[]).reduce(
    (acc, f) => {
      const p = FACTION_PALETTES[f];
      acc[f] = {
        primary: hexString(p.primary),
        secondary: hexString(p.secondary),
        accent: hexString(p.accent),
      };
      return acc;
    },
    {} as Record<Faction, { primary: string; secondary: string; accent: string }>,
  ),
);
