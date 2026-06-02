# User Prefabs Drop Folder

Drop `.glb` files here and they'll auto-register as prefabs in the Map Editor.

## Workflow

1. Save your .glb file in this folder (anywhere works, but a flat layout is simplest)
2. In the Map Editor, switch to **Place** or **Scatter** tool
3. Click the **⟳ Refresh** button in the Prefab Library panel
4. Your model appears in the library with `(user)` category

## Naming convention

The filename (minus `.glb`) becomes the display name. Hyphens and underscores
are replaced with spaces, words are capitalized. Examples:

- `concrete_bunker.glb` → "Concrete Bunker"
- `ruined-skyscraper-a.glb` → "Ruined Skyscraper A"

## Notes

- Auto-scaled to ~4m max dimension on load. Adjust per-prefab scale via the
  Library panel slider after placement.
- Don't put assets here that you want to share with other people — Git
  tracks this folder via .gitkeep but the actual .glb files are gitignored
  (they're treated as personal authoring assets).
- For production builds, this dev-only path will need replacing with the
  Tauri app-data directory.
