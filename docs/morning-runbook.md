# Morning Runbook — Child of Light Editor App

> **For:** you, waking up to a freshly-built editor that's never been launched on a Windows machine yet.
> **From:** the overnight orchestrator that scaffolded the Tauri app while you slept.
> **Goal:** get from "freshly cloned repo" to a working `Child of Light Editor.exe` on your desktop.

---

## TL;DR

Overnight, an autonomous agent chain built a **Tauri 2 + React 19 + TypeScript** desktop editor in `editor-app/`. The source code is complete and type-checks clean. To turn that source into a running app on your laptop, you need to install **Rust** and the **Microsoft C++ Build Tools** (the two pieces of Windows toolchain a developer needs to compile native apps), then run **two npm commands**. Expect **30 to 60 minutes** start to finish, most of which is waiting on installers and the first cold compile. No coding required — you copy, paste, click "Next", and watch progress bars.

---

## Scope

This runbook **does** cover:

- A quick toolchain check on your Windows laptop.
- Installing anything that's missing (Node.js, Rust, Microsoft C++ Build Tools).
- Running `npm install` and `npm run tauri dev` to bring the editor up in dev mode.
- (Optional) running `npm run tauri build` to produce a real `.exe` and `.msi` installer.
- Troubleshooting the most likely first-run errors.

This runbook **does not** cover:

- Integration with the future game engine (the engine doesn't exist yet — design phase, see [DESIGN.md](../DESIGN.md)).
- The V2 marketplace (deferred per [docs/editor-app-tauri-brief.md](editor-app-tauri-brief.md) — Non-Goals).
- Extensions to the voxel format beyond `sparse_grid_v1` (later phase work).
- Code-signing the produced `.exe` (requires a paid certificate; deferred to V2).

---

## Prerequisites

Before you start, make sure you have all of these:

- A **Windows 10 or Windows 11** machine. The Tauri stack targets Windows natively via the WebView2 runtime.
- **Administrator rights** on your laptop, so you can install developer tools without being blocked.
- A working **internet connection** — every installer downloads a few hundred MB.
- About **30 to 60 minutes** of attention. Most of that is watching install progress bars; you don't need to babysit every second.
- The repo already cloned at `C:\dev\Strategy Game\` and checked out on branch `claude/mobile-rts-game-concept-7LbT0`. (The orchestrator already did this — but if you ever need to re-do it: `cd C:\dev && git clone ... && cd "Strategy Game" && git checkout claude/mobile-rts-game-concept-7LbT0`.)

You do **not** need:

- Any prior coding experience. Everything below is "open this thing, click that thing, paste this command".
- Any IDE (Visual Studio, VS Code, etc.). PowerShell and a browser are enough.
- An Anthropic API key for this runbook — that's only for running Claude Code itself, not for building the editor.

---

## The body — step-by-step

The high-level shape of what you're about to do:

1. Open PowerShell, check what's already installed.
2. Install **Node.js** (probably already installed — fast check).
3. Install **Rust** (almost certainly missing — this is the big one).
4. Install **Microsoft C++ Build Tools** (Rust will ask for these if missing).
5. Refresh dependencies with `npm install`.
6. Launch the editor in dev mode with `npm run tauri dev`. Run the smoke test.
7. (Optional) Build the production installer with `npm run tauri build`.

If something goes wrong at any step, skip to the **Troubleshooting** section, fix it, and come back. The steps are forgiving — re-running them is safe.

---

### Step 1 — Open PowerShell and run the toolchain check

Press **Windows key + R**, type `powershell`, press Enter. A blue-ish window with a `PS>` prompt opens. That's PowerShell.

Copy and paste this in (you can right-click in PowerShell to paste). Each line is a separate command; press Enter after each, or paste them all and press Enter once:

```powershell
cd "C:\dev\Strategy Game\editor-app"
node --version
rustc --version
winget --version
```

What you're hoping to see:

- `node --version` prints something like `v18.18.0` or higher (anything `v18.x` or above is fine). Node.js is the JavaScript runtime that powers the frontend build.
- `rustc --version` prints something like `rustc 1.75.0` or higher. Rust is what compiles the native Windows shell of the editor.
- `winget --version` prints something like `v1.6.x`. Winget is Microsoft's built-in package manager, ships on Windows 10/11 — we'll use it to install Node.js if it's missing.

**Three possible outcomes:**

- **All three printed a version number** → great, your toolchain is ready. **Skip to Step 5.**
- **Only `rustc` errored** ("rustc is not recognized...") → that's the expected case. Continue with Step 3.
- **Anything else errored** → continue from whichever step matches the missing tool. Node is Step 2; Rust is Step 3; Winget is so rare to be missing on Win10/11 that if it errors you may want to update Windows first.

It's also fine if any of these print a *warning* (yellow text) — only a hard *error* (red text saying "not recognized") means the tool is missing.

---

### Step 2 — Install Node.js (only if `node --version` errored)

If Node was already installed (which it probably was — the Tauri scaffold required it during the overnight build), skip this step.

If it's missing, paste this into PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
```

Winget will download Node.js LTS (currently in the v20 line, perfectly fine) and install it system-wide. It takes about 2-3 minutes. You may see a Windows User Account Control prompt — click **Yes**.

**Important:** after the install finishes, **close PowerShell and reopen it**. Windows only picks up new tools on a fresh shell. Then re-run `node --version` to confirm it prints a version number.

---

### Step 3 — Install Rust (this is the most likely missing piece)

Rust is the language the editor's native shell is written in. You almost certainly don't have it. Here's the most foolproof way to install it:

1. Open your browser to **<https://rustup.rs/>**.
2. The page describes `rustup` (the official Rust installer). About a third of the way down there's a link to download **`rustup-init.exe`** for Windows. Click it.
3. The downloaded file lands in your Downloads folder. **Double-click `rustup-init.exe`** to run it.
4. A black-and-white console window opens with text describing what's about to happen. It will offer three options at the prompt: **1) Proceed with installation (default)**, **2) Customize installation**, **3) Cancel installation**.
5. Type **`1`** and press Enter. (Or just press Enter — option 1 is the default.)
6. Rust downloads and installs. Takes about **3-5 minutes** depending on your internet. You'll see lots of `installing component 'rustc'`, `installing component 'cargo'`, etc.
7. When it finishes, the console says something like `Rust is installed now. Great!` and waits for you to press Enter. Press Enter to close the installer.

**Crucial:** Rust adds itself to your `PATH` (the list of places Windows looks for commands), but **existing PowerShell windows don't know that yet**. Close every PowerShell window and open a fresh one.

Then verify:

```powershell
rustc --version
```

You should see something like `rustc 1.83.0 (90b35a623 2024-11-26)`. If you do, Rust is installed and on your PATH.

**Did Rust warn you about something during install?** Scroll back through the installer output — if it mentioned a missing **C++ linker** or **MSVC** or **Visual Studio Build Tools**, do Step 4. If it didn't mention them at all, you may still need them; you'll find out at Step 6 when `tauri dev` either compiles cleanly or errors with `linker 'link.exe' not found`. If that error appears, do Step 4 then come back.

---

### Step 4 — Install Microsoft C++ Build Tools (if Rust warned about MSVC missing)

Rust on Windows uses Microsoft's native linker (`link.exe`) to assemble compiled code into a `.exe`. That linker ships as part of the Visual Studio toolchain — specifically the "Build Tools" package, which is free.

Why this step matters: Tauri's Rust backend includes some Windows-specific crates that require the MSVC linker. Without it, the build will fail with a clear error message but will not auto-recover.

1. Open your browser to **<https://visualstudio.microsoft.com/visual-cpp-build-tools/>**.
2. Click the big **Download Build Tools** button. A file named `vs_BuildTools.exe` lands in Downloads.
3. **Double-click `vs_BuildTools.exe`** to run it. (Accept the UAC prompt.)
4. The Visual Studio Installer opens. It shows a tabbed interface with the **Workloads** tab selected.
5. You only need **one workload**: scroll until you see the tile labeled **"Desktop development with C++"**. Click it so the checkbox in the upper-right of the tile is checked.
6. On the right side of the screen you'll see "Installation details" with a list of components that will be installed and a total size (around 5-7 GB). You don't need to add anything optional.
7. Click **Install** in the bottom-right.
8. Wait. This is the slow one — **10 to 15 minutes**, sometimes longer on slow internet. The installer downloads and unpacks several GB of compilers, linkers, and Windows SDK headers.
9. When it says "Installation succeeded", **reboot your laptop**. Strictly speaking it's not always required, but it's the safest way to make sure the linker is discoverable by every shell.
10. After reboot, open a fresh PowerShell, `cd "C:\dev\Strategy Game\editor-app"` again, and continue.

You don't need to verify MSVC directly — if Step 6 (`tauri dev`) compiles past the Rust crates without complaining about a missing linker, MSVC is fine. If it errors with `link.exe not found`, MSVC is still missing.

---

### Step 5 — Refresh the npm dependencies

The overnight orchestrator ran `npm install` inside a Linux sandbox. That gave it a working `node_modules/` folder, but it has the **wrong native binaries** for some packages (notably `esbuild`, which ships per-OS compiled binaries). On Windows you need to re-run `npm install` to grab the Windows-flavored binaries.

In PowerShell, in the editor-app folder:

```powershell
cd "C:\dev\Strategy Game\editor-app"
npm install
```

This takes **1-2 minutes**. You'll see a stream of `added X packages, audited Y packages in Zs`. At the very end it might print:

- A summary line saying something like `added 234 packages, audited 235 packages in 47s` — good.
- A few `npm warn deprecated` lines — almost always safe to ignore; they refer to transitive dependencies that haven't been updated in a while.
- A `vulnerabilities` summary — also generally safe at this stage; we're not running this on a public server.

If you see **red `npm error`** text, that's a real problem — see **Troubleshooting** below.

You don't need to look at what got installed. `npm install` reads `package.json`, downloads everything listed there (React 19, Three.js, Tauri's JS bindings, Vite, TypeScript, Zod, etc.) into a `node_modules/` folder, and you're done.

---

### Step 6 — Launch the editor in dev mode

This is the moment of truth. In PowerShell, still in the editor-app folder:

```powershell
npm run tauri dev
```

What happens, in order:

1. **Vite starts the frontend dev server.** You'll see a line like `VITE v7.0.4 ready in 612 ms` followed by `Local: http://localhost:1420/`. Vite is now serving the React app on port 1420.
2. **Cargo (Rust's package manager) starts compiling the backend.** This is the slow part on a cold first run. You'll see lots of `Compiling tauri-utils v2.x`, `Compiling tauri v2.x`, `Compiling tauri-plugin-dialog v2.x`, etc. **First time: 5 to 10 minutes.** Subsequent runs: 10-30 seconds because Cargo caches everything.
3. When compilation finishes, a **native Windows window opens**. Its title bar reads "Child of Light Editor — Untitled [unsaved]" (or just "Child of Light Editor" if the title hasn't bound yet).
4. Inside the window you should see three panes side by side:
   - **Left pane** — the voxel chassis sculptor (3D scene with a grid floor and a build region).
   - **Center pane** — the attribute form (a scrolling list of input fields for chassis, parts, costs, etc.).
   - **Right pane** — the battlefield preview (3D scene with procedural terrain).
5. At the top there's a menu bar with **File**, **Help**, and a **Bump physics_version** action (or a button labelled that). The exact menu shape may evolve, but those names will be present.

**The v0.1 smoke test** — go through these in order to confirm the editor actually works:

1. Click somewhere in the **left pane** to place a voxel. (Pick a material from the palette first if there's one.) A small cube appears on the grid.
2. Glance at the **center pane** — the `mass` field should auto-update because voxel mass derives from voxel count and material density.
3. Glance at the **right pane** — the battlefield preview should rebuild its mesh showing your one voxel sitting on the terrain.
4. In the center pane, type a name into the unit's `name` field — say, "Test Unit 1".
5. **File → Save As** (or the equivalent menu action). A native Windows save dialog opens. Navigate to your **Desktop** and save the file as `test-unit.json`.
6. **Close the app** (click the X). The window closes.
7. **Relaunch with `npm run tauri dev`** (this time it's fast — about 10-30 seconds because Cargo cached the compile).
8. **File → Open** and pick the `test-unit.json` from your Desktop. The voxel you placed and the name you typed should both come back exactly as you left them.

If all of that works, **the v0.1 Definition of Done is met**. The whole point of an authoring tool is that it can save its state and load it back losslessly — you've just proven the editor does. Celebrate however you celebrate. You earned it.

You can leave the dev-mode app running while you explore. Press Ctrl+C in the PowerShell window to stop it when you're done.

---

### Step 7 — (Optional) Build the production installer

Dev mode is great for development but the window has a "Built with Tauri" feel and starts via the PowerShell process. To get a real, double-clickable `.exe` and a proper Windows installer:

```powershell
cd "C:\dev\Strategy Game\editor-app"
npm run tauri build
```

This:

1. Runs the frontend's production build (`vite build` + TypeScript compile). About 30 seconds.
2. Runs Cargo's **release-mode** compile. This is slower than the dev compile because release mode applies all the optimizations — about **3-5 minutes** on a fresh release build.
3. Packages everything into two outputs:
   - `editor-app/src-tauri/target/release/Child of Light Editor.exe` — the **standalone executable**. You can double-click this to launch the editor. It's portable; copy it anywhere.
   - `editor-app/src-tauri/target/release/bundle/msi/Child of Light Editor_0.1.0_x64_en-US.msi` — the **Windows installer**. Double-click it to install the editor system-wide (with a Start Menu shortcut and an entry in "Apps and Features"). This is what you'd hand to another player.

Once installed via the `.msi`, the editor appears in the **Start Menu** as "Child of Light Editor" alongside every other Windows app. Launching it from there gives you the full out-of-the-box experience.

The produced `.exe` is **not code-signed** — Windows SmartScreen may warn when you first run it ("Windows protected your PC"). Click **More info → Run anyway**. (Code-signing requires a paid certificate; see Open Questions.)

---

## Troubleshooting

If you hit any of these, here's the fix.

- **`error: linker 'link.exe' not found`** (during `tauri dev` or `tauri build`)
  → Microsoft C++ Build Tools are missing. Go back to **Step 4** and install them, then retry. After Step 4 you may need to reboot.

- **`error: failed to run custom build command for 'windows-sys'`** or similar
  → Usually MSVC or a Rust version mismatch. Run `rustup update` in PowerShell to refresh Rust to the latest stable, then retry. If that doesn't fix it, do Step 4.

- **The window opens but it can't read or write files, with errors mentioning `read_unit_file` or `write_unit_file`**
  → The Rust-side file commands may not be registered. Open `editor-app/src-tauri/src/lib.rs` and confirm: (1) there are two `#[tauri::command]` functions named `read_unit_file` and `write_unit_file`, and (2) both are listed in the `invoke_handler` chain (something like `.invoke_handler(tauri::generate_handler![read_unit_file, write_unit_file])`). If either is missing, the orchestrator's report will explain how to add them — but this should already be correct from the overnight build.

- **"Forbidden path" or "scope" errors when opening or saving**
  → Shouldn't happen because the editor uses custom Rust commands rather than the default `fs:*` capability. But if it does, open `editor-app/src-tauri/capabilities/default.json` and check that no `fs:*` permissions are set in a way that contradicts the custom commands. The default config we shipped does not use `fs:*` — if it has been changed, revert that change.

- **The window opens but the panes are blank/white**
  → A frontend JavaScript error is suppressing rendering. **Right-click inside the window and pick "Inspect"** (Tauri exposes the WebView2 dev tools in dev mode). The Console tab will show the error — copy it and paste it into a fresh Claude Code session for help.

- **`npm install` errors with `EACCES` or `permission denied`**
  → Run PowerShell as **Administrator** (right-click PowerShell in the Start Menu → "Run as administrator"), then re-run `npm install` from there. This is usually caused by an old `node_modules` left over from the Linux sandbox having Linux-only permission bits.

- **The first `tauri dev` build seems to hang for more than 15 minutes with no progress**
  → Open Task Manager (Ctrl+Shift+Esc) and look for `rustc.exe` or `cargo.exe`. If they're consuming CPU, it's just slow — keep waiting. If they're idle, Cargo may be stuck reaching crates.io. Press **Ctrl+C** in the PowerShell window to abort, then retry.

- **`Cargo cannot reach crates.io`** or other network errors during the Rust compile
  → Firewall or corporate proxy issue. If you're on a home network and antivirus is blocking Cargo, allow `cargo.exe` and `rustc.exe` through the firewall. If you're on a proxy network, you'll need a `~/.cargo/config.toml` with proxy settings — ask Claude Code to write one for you.

- **TypeScript errors in PowerShell during `tauri dev`**
  → The orchestrator type-checked the code before handing off, so this is unlikely. If it happens, the error message will name the file and line. Take a screenshot and ask Claude Code; the fix is usually a one-line type adjustment.

- **You see a leftover file called `tsconfig.bp.tmp.json` in `editor-app/`**
  → It's 1 byte and harmless. See Open Questions — you can delete it safely.

---

## Open questions

- `OPEN[2026-05-28]`: should the production `.exe` be **code-signed**? Code-signing requires a paid certificate (around $300/year from a Certificate Authority like Sectigo or DigiCert) and protects users from the Windows SmartScreen warning. **Deferred to V2** — for the v0.1 internal build the warning is fine.
- `OPEN[2026-05-28]`: should you **delete the stray `editor-app/tsconfig.bp.tmp.json`**? It's 1 byte, presumably a temp file from the overnight scaffold. Harmless, but lint-noisy. Lean delete after first successful build.

---

## Cross-references

- [docs/editor-app-tauri-brief.md](editor-app-tauri-brief.md) — the implementation contract for the Tauri editor (what was built, in what phases).
- [docs/editor-app-tauri-lift-map.md](editor-app-tauri-lift-map.md) — the file-by-file map of which prototype code was lifted into which React component.
- [docs/overnight-build-log.md](overnight-build-log.md) — the companion log of the overnight build, with what was done step-by-step.
- [DESIGN.md](../DESIGN.md) — the design constitution; in particular Principle 2 (Derived-stat discipline) and Principle 4 (Invariance) constrain what the editor is allowed to write into a unit's JSON.
- [HANDOFF.md](../HANDOFF.md) — the previous handoff from cloud Claude to local Claude, the bridge that brought this project to your laptop in the first place.
