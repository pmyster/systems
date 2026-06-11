# Child of Light — Unit Editor

A self-contained browser-based tool for authoring unit Schematics. No installation, no server, no internet required once you have the file.

## The five-second version

1. Save `index.html` somewhere on your computer (Desktop, Documents, anywhere).
2. Double-click it.
3. The editor opens in your default browser.
4. Start designing units.

That's it. The file is ~40 KB. It includes everything it needs.

## What it does

A three-pane interface:
- **Left**: form inputs — meta (name, faction, designer), chassis attributes (mass, engine, drivetrain, energy, armor), parts (weapon / sensor / defense / utility / mobility / communications), costs.
- **Middle**: live JSON preview, updated on every keystroke. Conforms to `schemas/unit.schema.json`.
- **Right**: derived stats — top speed, fuel range, power balance, defense totals, per-weapon ballistics (muzzle velocity, effective range, sustained rate-of-fire). Computed from your physical inputs using simplified versions of the engine's equations.

Use the header buttons:
- **New** — fresh unit with sane defaults.
- **Load JSON** — pick a `.json` file from your computer to edit. Try loading any of the starter units (see below).
- **Save JSON** — download the current unit as a `.json` file.
- **Clear** — same as New.

## Starter units (load these to see working examples)

The repo's `units/starter/` directory has six pre-built units across factions and chassis classes:

| File | What it is |
|---|---|
| `reclaimer-patcher.json` | Basic Reclaimer salvage walker, tier-1 utility |
| `bulwark-stonefist.json` | Heavy Bulwark turret with shield, tier-2 defensive |
| `signal-whisper.json` | Signal stealth scout, tier-1 recon |
| `cinder-pyre.json` | Cinder Crown incendiary skirmisher, tier-1 area-denial |
| `aerial-watcher.json` | Neutral fuel-bounded recon aircraft |
| `static-sentinel.json` | Neutral defensive turret |

Save these to your computer alongside `index.html`, then use Load JSON to open them.

## Deployment options

### Option A: Local file (recommended for solo authoring)

Just keep `index.html` on your computer. Open it whenever you want to design units. Save your designs as JSON files in a folder. Done.

**Pros:** zero setup, zero internet required, your files stay private.
**Cons:** sharing with collaborators requires sending JSON files manually.

### Option B: GitHub Pages (recommended for sharing a live URL)

If you want a permanent web URL anyone can visit:

1. In your repo settings on GitHub, enable Pages.
2. Choose source: either a `gh-pages` branch (created from the file) or the `tools/editor/` folder of any branch.
3. GitHub gives you a URL like `https://pmyster.github.io/systems/`.

The exact path depends on which folder/branch you serve. The simplest setup:
- Create a `gh-pages` branch with just `index.html` at root.
- Enable Pages from that branch.
- Your editor lives at `https://pmyster.github.io/systems/`.

**Pros:** stable URL, shareable, no third-party services.
**Cons:** requires a one-time GitHub Pages setup.

### Option C: Truly native desktop app (future)

When the editor's feature set stabilizes (voxel chassis sculpting, marketplace integration, real-time previewing), the right path is to wrap it in **Tauri** (Rust + system webview, very lightweight, ~3 MB installer) or **Electron** (heavier but more flexible). The current HTML editor is the spec for that future app — same UI, same JSON output, just packaged as a native installer for Mac / Windows / Linux / iOS / Android.

This is deferred work tied to V1 milestone planning. For now, the HTML version is the editor.

### Option D: Bundle into the main game app

The eventual production form: the unit editor is a *scene* inside the main Child of Light app, alongside the in-game editor and marketplace browser. Same JSON output, integrated workflow.

## File format

Saved units are JSON conforming to `schemas/unit.schema.json` in the repo root. If you use VS Code or another JSON-schema-aware editor, you can reference the schema directly for autocomplete and validation:

```json
{
  "$schema": "../../schemas/unit.schema.json",
  "kind": "unit",
  "id": "my-unit",
  ...
}
```

## Authoring conventions (the rules behind the rules)

Per the design constitution, the editor only accepts **physical inputs** — mass in kilograms, engine power in kilowatts, propellant energy in megajoules, thermal capacity in megajoules, etc. Gameplay numbers (speed, range, damage, cooldown) are *derived* by the engine from those inputs through the equations in `docs/physics.md`.

You don't type "this unit moves at 24 m/s." You type "this chassis weighs 30,000 kg and has an 800 kW engine with 70% drivetrain efficiency" — and the engine computes the speed.

This means you can't make an overpowered unit by typing big numbers. To make a unit faster, you have to give it a bigger engine — which costs more power, generates more heat, and consumes more fuel. The tradeoffs are automatic.

The derived stats panel on the right shows what the engine *would* compute from your inputs. They're simplified for the prototype but give you the right feel for the relationships.

## Limits of this prototype (v0.1)

What the prototype *does not* do (deliberately — these come in the full Editor App):
- **No voxel chassis sculpting.** You describe the chassis by attributes; you don't sculpt the shape. The full app will let you sculpt a voxel volume that determines mass distribution, armor coverage, and silhouette.
- **No visual rendering of the unit.** You see the JSON and the stats; you don't see what the unit looks like.
- **No part library.** You author parts inline. The full app will have a browsable library of stock and community parts.
- **No salvage signature workflow.** The `designer` field is manual; the full app will manage signatures across derivative chains.
- **No marketplace integration.** Save/load is local files only.

## Related files in the repo

- `tools/editor/index.html` — this editor
- `schemas/unit.schema.json` — formal Unit Schematic JSON Schema
- `schemas/part.schema.json` — formal Part Schematic JSON Schema
- `units/starter/*.json` — starter units to load and modify
- `docs/editor-app.md` — full Editor App design (vision + prototype + future)
- `docs/architecture.md` — engine architecture (how the Schematic Loader consumes what you export)
- `docs/physics.md` — equation catalog (the real versions of the formulas the prototype simplifies)
- `DESIGN.md` — design constitution (Principle 2: Derived-stat discipline is the rule the editor enforces)
