# 3D Printer Planner

A small Windows desktop app for planning long 3D-printing projects.

- **Projects → queues → items.** A project (say, a helmet) holds named queues (one per filament or plate), and each queue holds your model files.
- **Drop files in.** Drag STL, 3MF, OBJ, STEP, AMF or G-code files onto a queue, or use **Add files**. They are copied into your library, so moving or deleting the originals is safe.
- **Open in your slicer.** The top card in *To do* is your next print. **Slicer** opens it in ElegooSlicer (detected automatically) or any slicer you choose in Settings. When the slicer saves `part.3mf` or `part_plate_1.gcode` next to the model, the app attaches it to the item, and the next **Open in slicer** opens your saved project.
- **Track progress.** A board with *To do / Printing / Done / Failed*. Each item has a quantity and copies per plate: **Finished** adds a plate's worth of copies, and the card returns to *To do* until the quantity is reached. Every start, finish and failure is kept in the item's history.
- **See where you're at.** Each project shows how much is printed, plus the print time and filament left (from your per-plate estimates).

## Install

Download the latest installer from the [Windows build workflow](../../actions/workflows/build-windows.yml) artifacts (or a GitHub release). It is not code-signed, so Windows SmartScreen will warn: choose **More info → Run anyway**.

## Your library

Everything lives in `Documents\3D Planner` by default:

```
3D Planner/
  planner.db                      projects, queues, items, history
  projects/<project>/<queue>/     your model files and slicer output
```

Move it from **Settings → Move library…** (for example into OneDrive as a backup). Use it from one PC at a time. Deleting an item, queue or project sends its files to the Recycle Bin.

## Development

Requires Node 22+ and stable Rust.

```bash
npm install
npm run tauri dev       # run the app
npm test                # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml   # backend tests
npm run tauri build     # build installers for the current OS
```

Built with Tauri 2, React, TypeScript, SQLite and three.js.
