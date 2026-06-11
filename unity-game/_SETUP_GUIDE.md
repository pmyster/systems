# Child of Light — Unity Game Setup

## Prerequisites
- Windows 10/11
- ~15 GB free disk space for Unity Editor + packages

---

## 1. Install Unity Hub
Download from: https://unity.com/download  
Run the installer and sign in with a Unity account (free Personal license is fine).

---

## 2. Install Unity 6
In Unity Hub → **Installs** → **Install Editor** → select version **6000.x LTS**.  
Modules to include:
- **Universal Render Pipeline** (included by default in 6000.x)
- **Windows Build Support** (already selected on Windows)
- **Visual Studio** integration (or your preferred IDE)

---

## 3. Create the Project
Unity Hub → **New Project** → template: **3D (URP)**.  
- **Name:** `ChildOfLight`  
- **Location:** `C:\dev\Strategy Game\unity-game`  
- Click **Create**.

Unity will open and compile the default URP template.  Wait until the status bar shows no spinner.

---

## 4. Add Newtonsoft.Json Package
Required by `SchematicLoader.cs` and `UnitSchematic.cs` for JSON deserialisation.

**Window → Package Manager → + (top-left) → Add package by name**  
```
com.unity.nuget.newtonsoft-json
```
Click **Add**.  Unity will download and compile the package.

---

## 5. Add NavMesh Package (unit pathfinding)
Required by `MovementSystem.cs`.

**Window → Package Manager → + → Add package by name**  
```
com.unity.ai.navigation
```
Click **Add**.

---

## 6. Drop in the Scripts
The `Assets\Scripts\` folder in this repo is the complete script set.  
Copy it into the new Unity project's `Assets\` folder:

```
Source:       C:\dev\Strategy Game\unity-game\Assets\Scripts\
Destination:  C:\dev\Strategy Game\unity-game\Assets\Scripts\   (same path if project was created here)
```

If Unity created the project in a sub-folder (e.g., `ChildOfLight\`), copy the scripts there.

All scripts will compile automatically when Unity regains focus.  Check the Console for any errors before continuing.

---

## 7. Set Up the Scene

### Camera
1. Select **Main Camera** in the Hierarchy.  
2. Set **Transform:** Position `(0, 40, -20)`, Rotation `(60, 0, 0)`.  
3. Attach `Assets/Scripts/Gameplay/RTSCamera.cs`.  
4. In the Inspector, adjust **Bounds Min / Max** to match your map size.

### SelectionManager
1. **Hierarchy → Create Empty** → rename `SelectionManager`.  
2. Attach `Assets/Scripts/Gameplay/SelectionManager.cs`.

### HUDManager
1. **Hierarchy → Create Empty** → rename `HUDManager`.  
2. Attach `Assets/Scripts/UI/HUDManager.cs`.  
3. Create a **Canvas** (UI → Canvas) with a **Screen Space - Overlay** render mode.  
4. Inside the Canvas, add:
   - A **Panel** (`selectionPanel`) containing:
     - `TMP_Text` for unit name, role, speed, range, selected count
     - `Slider` for HP bar
   - Three `TMP_Text` labels for Power, Scrap, Alloy
   - A **Raw Image** for the minimap
5. Wire all these references in the HUDManager Inspector.

### Faction Controllers
Create one empty GameObject per faction (4 total), named:
- `FactionController_Reclaimer` (check **Is Player Faction**)
- `FactionController_Bulwark`
- `FactionController_Signal`
- `FactionController_CinderCrown`

Attach `Assets/Scripts/Gameplay/FactionController.cs` to each. Set the **Faction** dropdown.

---

## 8. Sculpt the Map
1. **Hierarchy → 3D Object → Terrain**.  
2. In the Terrain component, use Paint Holes and Raise/Lower Terrain tools to sculpt a hill with ridgelines (the core loop requires a ridge for Artillery to shoot from).
3. Scale the Terrain to suit your map size (default 1000×1000 is good for a prototype).

---

## 9. Bake a NavMesh
1. Select the Terrain object.  
2. In the Inspector → **Navigation (Mesh)** component (added automatically by the AI Navigation package) → set as **Navigation Static**.  
3. **Window → AI → Navigation** → open the **Bake** tab → click **Bake**.  
4. The blue overlay shows walkable area.  Rebake after any terrain changes.

---

## 10. Create a Unit Prefab
1. **Hierarchy → 3D Object → Capsule** (placeholder mesh).  
2. Rename it `Unit_Scout`.  
3. Attach these components:
   - `UnityEngine.AI.NavMeshAgent` — the pathfinding brain  
   - `Assets/Scripts/Gameplay/MovementSystem.cs`  
   - `Assets/Scripts/Gameplay/CombatSystem.cs`  
   - `Assets/Scripts/Gameplay/UnitController.cs`  
4. Set **Faction** in the UnitController Inspector.  
5. Drag it into `Assets/Prefabs/` to save as a Prefab, then delete the scene instance.

For the selection highlight: add a small flat **Plane** child object with a green emissive material, then assign it as **Selection Indicator** in the UnitController Inspector.

---

## 11. Load a Unit From a Schematic

In your game-start code (e.g., a `GameManager.cs`):

```csharp
using ChildOfLight.Core;
using ChildOfLight.Gameplay;

// Load from the editor app's output folder directly — no file copying needed.
var schematic = SchematicLoader.LoadFromPath(
    @"C:\dev\Strategy Game\units\starter\scout.json");

if (schematic != null)
{
    var prefab = Resources.Load<GameObject>("Prefabs/Unit_Scout");
    var go     = Instantiate(prefab, spawnPosition, Quaternion.identity);
    go.GetComponent<UnitController>().InitFromSchematic(schematic);
}
```

Or load all schematics in a directory at once:

```csharp
var catalogue = SchematicLoader.LoadAllFromDirectory(
    @"C:\dev\Strategy Game\units\starter\", recursive: true);
```

---

## 12. Link the Editor Output
Units saved from the companion Editor App land in:
```
C:\dev\Strategy Game\units\starter\
```
Point `SchematicLoader.LoadFromPath()` at those files directly.  
No file copying needed — the game reads them live from disk.

For a shipped build, copy the `units\` directory into `Assets\StreamingAssets\units\` and use `SchematicLoader.LoadFromStreamingAssets("units/starter/scout.json")` instead.

---

## Namespace Reference
All scripts use the `ChildOfLight.*` namespace tree:

| Namespace | Contents |
|---|---|
| `ChildOfLight.Core` | UnitSchematic, SchematicLoader, PhysicsConstitution |
| `ChildOfLight.Gameplay` | UnitController, RTSCamera, SelectionManager, MovementSystem, CombatSystem, FactionController, ProductionBuilding |
| `ChildOfLight.AI` | SimpleAI |
| `ChildOfLight.UI` | HUDManager |
| `ChildOfLight.Utilities` | ObjectPool<T> |

---

## Core Loop Validation Checklist
- [ ] Spawn Scout behind a ridgeline
- [ ] Spawn Artillery on the ridge
- [ ] Spawn an MBT to push toward the enemy
- [ ] Enemy Bulwark faction defends — watch it patrol and counter-attack
- [ ] Artillery fires at spotted enemies (range >> direct-fire units)
- [ ] Shields (HP bars) buckle under sustained fire
- [ ] Factory builds a new unit when triggered via `EnqueueUnit("scout_mk1")`
- [ ] Cinder Crown AI attack-moves aggressively toward the player base

---

## Package Versions (Unity 6000.x)
| Package | Version tested |
|---|---|
| com.unity.nuget.newtonsoft-json | 3.2.1 |
| com.unity.ai.navigation | 2.0.x |
| com.unity.render-pipelines.universal | 17.x (bundled with URP template) |
| TextMeshPro | 3.x (bundled with Unity 6) |
