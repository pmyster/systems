# Cube Dash

A hyper-casual mobile endless runner built in Unity 6 (C#). Three lanes,
swipe to move, tap to jump, dodge red obstacles, collect coins. Ships to
iOS and Android. Designed as a sellable, complete starter you can skin,
balance, and publish.

```
┌───────────────────────────────────────────────────┐
│  SCORE  742                                       │
│  ¤ 12                                             │
│                                                   │
│      ┌──┐                                         │
│      │  │           ░░░░░          ●●●           │
│      └──┘            ░░             ●            │
│  ─────────────────────────────────────            │
│   ←  Player  →                                    │
└───────────────────────────────────────────────────┘
```

## What's in the box

- **Complete gameplay loop** — menu → run → game over → restart.
- **Zero scene-wiring** — `Bootstrap.cs` programmatically assembles the
  camera, lighting, world, player, spawner, and UI at runtime. Open the
  project and press Play.
- **No art assets required** — all visuals are Unity primitives + flat
  colours. The look is intentional (hyper-casual aesthetic). Swap in your
  own art whenever you like.
- **Procedural SFX** — synth blips at runtime for jump/coin/crash. Drop
  real `.wav`/`.ogg` files into `Assets/Resources/Audio/` (named
  `jump`, `coin`, `crash`) to replace them.
- **Difficulty curve** — speed ramps over time; obstacle spawn rate
  scales with speed; jumpable/dodgeable patterns mixed.
- **Score + best-score persistence** via `PlayerPrefs`.
- **Mobile-first input** — swipe left/right to switch lanes, tap to
  jump, swipe up to jump. Keyboard (A/D, ←/→, W/Space) works too for
  editor testing.
- **Monetization hooks** — `Monetization.cs` exposes `ShowInterstitial`,
  `ShowRewarded`, and `Purchase` as stubs. Interstitial is auto-called
  every 3 game-overs. Wire your SDK of choice (LevelPlay, AdMob, Unity
  IAP) into the stubs.
- **One-click mobile builds** — `Cube Dash → Build Android (.aab)` and
  `Build iOS (Xcode project)` menu items.

## Getting it running

### 1. Install Unity

Install **Unity 6 LTS (6000.0.x)** via Unity Hub:
<https://unity.com/download>. During install, add the **Android Build
Support** and/or **iOS Build Support** modules.

This repo's `ProjectSettings/ProjectVersion.txt` pins `6000.0.32f1`, but
any 6000.0.x patch version should open it cleanly.

### 2. Open the project

```bash
git clone <your-fork-url>
cd systems
# Open Unity Hub → "Open" → select this folder.
```

On first open, Unity will:
1. Generate the `Library/` cache (1–3 min).
2. Auto-run `ProjectInitializer` (Editor script), which creates
   `Assets/Scenes/Main.unity` with a single `Bootstrap` GameObject and
   adds it to Build Settings.

When the editor finishes loading, press **Play**. The game runs.

### 3. Test on a phone

**Android** (fastest path):

1. Plug in your device with USB debugging enabled.
2. `File → Build Settings → Android → Switch Platform`.
3. Menu: `Cube Dash → Build Android (.aab)`. Output goes to `Builds/`.
4. For a quick test APK instead, uncheck "Build App Bundle" in Build
   Settings and rebuild.

**iOS**:

1. `File → Build Settings → iOS → Switch Platform`.
2. Menu: `Cube Dash → Build iOS`. Open the generated Xcode project in
   `Builds/iOS/`, sign with your team, run on device.

## What to change before publishing

These are the things you must edit before submitting to a store:

- `Assets/Editor/MobileBuilder.cs`:
  - `CompanyName` → your studio name.
  - `PackageId` → unique bundle id, e.g. `com.yourstudio.cubedash`.
- App icon: `Project Settings → Player → Default Icon`. Drop a 1024×1024
  PNG.
- Splash screen: Unity Personal shows the Made-With-Unity splash. To
  remove it you need Unity Pro/Plus, or you can customise it under
  `Player → Splash Image`.
- Privacy policy URL — required by both stores. Host one and link it on
  your store listing.

## Monetization integration

The game ships with **stub** monetization that prints to the console.
Pick one path:

### Option A — Sell as paid app ($0.99 – $2.99)

Easiest. Strip `Monetization.cs` if you want, or leave it. List as a
paid app in App Store Connect / Google Play Console.

### Option B — Free with ads (recommended for hyper-casual)

1. Install **Unity LevelPlay** via Package Manager:
   `com.unity.services.levelplay`.
2. Replace the `TODO` bodies in `Assets/Scripts/Monetization.cs`:
   - `Initialize()` → `IronSource.Agent.init("YOUR_APP_KEY");`
   - `ShowInterstitial()` → `IronSource.Agent.showInterstitial();`
   - `ShowRewarded()` → call `IronSource.Agent.showRewardedVideo()` and
     wire the reward callback to `onReward.Invoke()`.
3. Optional: add a "Continue (watch ad)" button on the game-over panel
   that calls `Monetization.I.ShowRewarded(() => GameManager.I.Revive())`
   — you'd add a `Revive()` method on `GameManager` that resets the
   player position without resetting the score.

### Option C — Freemium / IAP

1. Install **In-App Purchasing** via Package Manager:
   `com.unity.purchasing`.
2. Define products (e.g. `remove_ads`, `skin_neon`, `coin_pack_100`).
3. Wire `Monetization.Purchase()` to the IAP module.

## File map

```
Assets/
├── Scripts/
│   ├── Bootstrap.cs          Self-assembles the whole scene.
│   ├── GameManager.cs        State machine, score, persistence.
│   ├── InputManager.cs       Swipe + keyboard, emits directional events.
│   ├── PlayerController.cs   Lane switching, jump, collision.
│   ├── TrackManager.cs       Endless ground tiles + rails.
│   ├── ObstacleSpawner.cs    Procedural obstacle + coin spawning.
│   ├── UIManager.cs          HUD, menu, game-over screens (uGUI).
│   ├── AudioManager.cs       Procedural SFX (replace with real audio).
│   ├── Monetization.cs       Stub ad/IAP hooks.
│   └── MaterialFactory.cs    Built-in / URP shader helper.
└── Editor/
    ├── ProjectInitializer.cs Creates Main.unity on first open.
    └── MobileBuilder.cs      Cube Dash menu: Configure, Build Android, Build iOS.
```

## Roadmap suggestions

Things to add to go from "starter" to "competitive product" without
rewriting:

- **Character skins** — swap the player material, gated by coins / IAP.
- **Daily rewards** — track last-played date in `PlayerPrefs`, give a
  coin bonus on consecutive days.
- **Combo multiplier** — chain coins without missing to double their
  value.
- **Power-ups** — magnet (coins fly to you), shield (one free hit),
  jetpack (10s of flight).
- **Themes** — alternate palettes/music every 200m for visual variety.
- **Leaderboards** — Google Play Games + Apple Game Center, both free.
- **Polished particles** — add `ParticleSystem` bursts on jump/coin/
  crash. Big perceived-quality jump for ~1h of work.

## Licence

See `LICENSE`.
