# Starter Pack — turn photos into RTS units

This folder is a self-contained pipeline that turns ordinary photographs into playable units in your Child of Light RTS.

You drop photos in. You run one command. Units appear in Match Setup. That's the whole loop.

---

## What got installed last night

Claude set everything up while you slept:

- **Hunyuan3D-2-mini** (Tencent's open photo-to-3D model, 0.6B params) at `starter-pack/Hunyuan3D-2/`
- **Python venv** with PyTorch + CUDA 12.1 at `starter-pack/venv/`
- **Model weights** (~7 GB) cached at `starter-pack/_hf_cache/` — fully offline after this point
- **Pipeline scripts** at `starter-pack/scripts/`
- **Sanity check passed**: a synthetic test tank silhouette was converted to a 91k-vertex mesh + valid schematic in 6.8 seconds.

You don't need to touch any of that. Just use the morning workflow below.

---

## Morning workflow

### Step 1 — Drop photos into the right folders

```
editor-app/starter-pack/photos/
    tank/        <-- tank photos
    mech/        <-- mech / walker photos
    infantry/    <-- soldier / robot infantry photos
    aircraft/    <-- plane / drone photos
```

**Photo guidelines for good results:**

- Side view or 3/4 view (not pure top-down or pure straight-on)
- Single subject — no extra vehicles or people in the frame
- Plain background works best (you can have a busy one — we'll cut it out automatically)
- Minimum size: 256×256 pixels; 512+ recommended
- Format: `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`

You can mix any number per folder. 10-15 across all four folders is the sweet spot for ~10 minutes total.

### Step 2 — Run the one command

Open PowerShell, paste this:

```powershell
cd "C:\dev\Strategy Game\editor-app"
npm run starter-pack
```

That's it. Wait. Per photo: roughly 5-10 seconds (after a 60-second model load on the first run of the day). For 15 photos: about 5 minutes total.

When the run finishes you'll see a summary like:

```
SUMMARY: processed=15, succeeded=14, failed=1
  OK   my_tank.jpg       -> my_tank         (6.2s)
  OK   bipedal.png       -> bipedal         (7.1s)
  ...
  FAIL blurry_dude.jpg [infantry] -- photo rejected: image is 150x150 -- minimum 256x256 required.
```

### Step 3 — Use them in a match

Launch the dev build:

```powershell
npm run tauri dev
```

Go to **Play** tab → **Pick Units**. Browse to:

```
C:\dev\Strategy Game\editor-app\units\tank\
    (or units\mech\, units\infantry\, units\aircraft\)
```

Each photo became one `.json` file. Multi-select any combination, click **Load Match**, and they spawn in the world with the photo turned into a 3D model.

---

## If something fails

Three places to look (in priority order):

1. **The `.error.log` file** next to the photo that failed. Tells you exactly why that one photo broke.
2. **`starter-pack/_logs/run_<timestamp>.log`** — full transcript of the run.
3. **`starter-pack/_logs/summary_<timestamp>.json`** — machine-readable per-photo result.

### Common failures

| Symptom in error log | Cause | Fix |
|---|---|---|
| `photo rejected: image is XxY -- minimum 256x256` | Photo too small | Use a bigger photo |
| `CUDA out of memory` | Other apps using GPU | Close Chrome / other GPU-heavy apps; or run with lower quality: `npm run starter-pack -- --octree 160 --chunks 2000` |
| `pipeline returned empty mesh` | Diffusion model couldn't extract the subject silhouette | Try a clearer photo: better lighting, cleaner background, less clutter |
| `class template lookup` failed | Photo dropped in an unrecognized folder | Move photo to one of the four registered class folders, or add a new class (see "Adding a new class" below) |

---

## Re-running hygiene without re-running Hunyuan3D

If we ship a hygiene update (e.g. better mesh consolidation, decimation
thresholds) and you want your existing units to benefit, run:

```powershell
cd "C:\dev\Strategy Game\editor-app"
npm run starter-pack -- --rehygiene-only
```

This skips the slow Hunyuan3D inference and just re-processes the existing
`.glb` files in `units/<class>/meshes/`. Takes ~5 seconds per file.

What it does to each mesh:

1. Loads the existing `.glb` and drops the tiny hardpoint marker nodes.
2. Consolidates any sub-mesh fragmentation into one cohesive Trimesh
   (the runtime renders each Mesh node as a separate InstancedMesh slot;
   one node = one solid silhouette).
3. Re-runs center + scale + degenerate cleanup.
4. Decimates if face count > 50,000 (quadric edge collapse; preserves
   silhouette, drops GPU cost dramatically).
5. Re-stamps hardpoint markers at the template's relative positions.
6. Writes back atomically.

The `.json` schematics are NOT rewritten — they're still valid, since
the bbox-relative hardpoint plan + chassis class haven't changed.

---

## Quality / VRAM tuning

The pipeline ships with conservative defaults sized for an 8 GB GPU:

```
--octree 256    # mesh density. 256 default. 192 = lower-VRAM. 380 = higher detail.
--steps 30      # diffusion steps. Lower = faster, less detail.
--chunks 8000   # mesh extraction batch size. Lower = less VRAM, slower.
```

If you have a quieter GPU moment (closed everything else) you can push to higher quality:

```powershell
npm run starter-pack -- --octree 380 --chunks 16000
```

If you get OOM errors, dial down:

```powershell
npm run starter-pack -- --octree 192 --chunks 4000
```

---

## Tuning a unit after it's generated

Every generated unit gets **placeholder** physical inputs from the class template:

- Tank: 50 tonnes, 600 kW engine, 250 mm steel front armor
- Mech: 35 tonnes, 900 kW engine, 180 mm composite front armor
- Infantry: 120 kg, body armor, 1 weapon
- Aircraft: 12 tonnes, 8000 kW engine, lightly armored

Plus **one default weapon** per unit (`starter_weapon_1`): a kinetic 200 kg gun, 4 MJ propellant, ~1.5s fire rate. No projectile assigned yet — you pick one in the editor.

To tune: open the unit's `.json` in the **Unit Editor** tab. Every field shows up in the form. Change armor, mass, weapon stats, mount a different weapon part, whatever.

**The schematic is just JSON** — you can also edit it in any text editor. The schema definition lives at `editor-app/src/lib/zod-schemas.ts` (`UnitSchematicSchema`).

---

## Adding a new class (e.g. naval, artillery, etc.)

The class registry is data-driven. Add one entry to one Python file:

`editor-app/starter-pack/scripts/hardpoint_templates.py`:

```python
CLASS_TEMPLATES = {
    "tank": ClassTemplate(...),
    "mech": ClassTemplate(...),
    "infantry": ClassTemplate(...),
    "aircraft": ClassTemplate(...),
    # ADD HERE:
    "naval": ClassTemplate(
        chassis_class="naval_surface",
        default_mass_kg=500_000,
        default_length_m=80.0,
        # ...all the other fields, copy from "tank" and adjust
    ),
}
```

Then create the matching folder:

```
editor-app/starter-pack/photos/naval/   <-- drop boat photos here
```

That's it. `process.py` discovers the new class automatically next run. The validation at the top of `hardpoint_templates.py` will refuse to load if any enum value in your new template doesn't match the runtime schema — so if you typo a chassis_class, you'll see it immediately (loud over silent).

---

## Architecture notes (for the curious)

```
photos/<class>/photo.jpg
        |
        |  process.py
        v
[1] validate_photo            <-- gates: size, format
[2] hunyuan_wrapper           <-- Hunyuan3D-2-mini diffusion: image -> raw mesh (Trimesh or Scene)
[3] hygiene.consolidate       <-- merge any sub-mesh fragmentation into ONE Trimesh
[4] hygiene.normalize         <-- center, scale to 8m, clean degenerates, decimate if > 50k faces
[5] hardpoint_templates       <-- class template: chassis class, mass, armor, hardpoint positions
[6] hygiene.stamp_hardpoints  <-- add named scene-graph nodes for each hardpoint
[7] schematic_gen.build       <-- assemble UnitSchematic JSON matching zod-schemas.ts
[8] verify.validate           <-- pydantic mirror of Zod, catches shape errors before write
        |
        v
units/<class>/<id>.json
units/<class>/meshes/<id>.glb
```

Per the engineering standard in `CLAUDE.md`:

- Every step has a default branch + visible failure path (loud over silent).
- The class registry is adaptive — new classes show up the moment you add one.
- Schema mirror in `verify.py` catches drift between Python output and the runtime's TypeScript Zod.

---

## File locations

| Thing | Path |
|---|---|
| Drop photos here | `editor-app/starter-pack/photos/<class>/` |
| Generated schematics | `editor-app/units/<class>/<id>.json` |
| Generated meshes | `editor-app/units/<class>/meshes/<id>.glb` |
| Per-run logs | `editor-app/starter-pack/_logs/run_<timestamp>.log` |
| Per-photo error logs | next to the failing photo, as `<photo>.<ext>.error.log` |
| Pipeline scripts | `editor-app/starter-pack/scripts/` |
| Model weights cache (don't touch) | `editor-app/starter-pack/_hf_cache/` |
| Python venv (don't touch) | `editor-app/starter-pack/venv/` |

---

## Reset / re-install

If something gets weird (corrupted cache, partial install, Python version drift), you can blow away the venv and ask Claude to re-bootstrap:

```powershell
# Don't do this unless you're rebuilding from scratch:
Remove-Item -Recurse -Force "C:\dev\Strategy Game\editor-app\starter-pack\venv"
Remove-Item -Recurse -Force "C:\dev\Strategy Game\editor-app\starter-pack\_hf_cache"
Remove-Item -Recurse -Force "C:\dev\Strategy Game\editor-app\starter-pack\Hunyuan3D-2"
```

Then prompt Claude with: "re-bootstrap the starter-pack from scratch."

The rest of `editor-app/` is untouched — only the starter-pack folder gets wiped.
