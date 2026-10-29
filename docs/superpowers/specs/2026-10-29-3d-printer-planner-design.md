# 3D Printer Planner — Design

Date: 2026-10-29
Status: draft, awaiting approval (builder check done)

## Intent

A quick, clean desktop app (Windows first) for planning long-running 3D-printing
projects. You collect model files (STL, 3MF, …) into named queues inside projects,
open the next one in your slicer (ElegooSlicer by default) to edit/save/send to the
printer, then come back to the app to see at a glance what is to do, printing,
done or failed. It replaces the mental bookkeeping of "which parts of this
project have I already printed, and how many".

## Goals

- Projects → named Queues → Items (one item = one model file + quantity).
- Add files by drag-and-drop onto a queue, or with a file-browser dialog.
- Files are **copied** into the app's library, organised on disk by project/queue.
- One click "Open in slicer" on an item opens the **library copy** in the
  configured slicer. Slicers save a new `.3mf` project (and G-code) rather than
  overwriting an STL, so an item owns **several files**: the original model plus
  any derived `.3mf`/`.gcode` the slicer writes into the item's queue folder.
  The app watches library queue folders and attaches new files to the item whose
  original shares the file stem (e.g. `bracket.stl` → `bracket.3mf`,
  `bracket_plate_1.gcode`). Unmatched new files appear as an "Unassigned files"
  notice on the queue for the user to attach or turn into a new item.
  "Open in slicer" opens the newest `.3mf` if one exists, else the original.
- Default slicer configurable in settings (path to the .exe); ElegooSlicer
  auto-detected if installed in its standard location.
- Kanban board per queue: columns **To do / Printing / Done / Failed**, drag cards
  between columns and reorder within To do. Top of To do = "next up".
- Quantity per item with progress (e.g. 2/4) and a **copies per plate** number
  (default 1). "Print finished" adds copies-per-plate to the done count (capped at
  the total); the card moves to Done only when the total is reached. The done
  count can also be edited by hand.
- Per-item metadata: material, colour, notes/settings, estimated print time,
  estimated grams. All user-entered in v1.
- 3D thumbnail preview of each model on its card.
- Project overview: progress % (done prints / total prints), totals for estimated
  time and grams remaining.
- Dark theme by default, light toggle.
- Library location: `Documents\3D Planner` by default, changeable in settings
  (e.g. to a OneDrive folder for backup). Changing it **moves** the library
  (files + `planner.db`) to the new folder and repoints the app. Single PC only;
  sharing one library across PCs is a non-goal.
- Windows installer built by GitHub Actions: unsigned (SmartScreen "Run anyway"
  is accepted), no auto-update. Releases are downloaded from GitHub manually.

## Non-goals (v1)

- Automatic printer status (network integration). Status is manual in v1.
- Multiple printers in the UI. One printer assumed.
- Slicing inside the app, or parsing G-code.
- Cloud sync / accounts / multi-user / one library shared by several PCs.
- Code signing and auto-update.
- macOS/Linux releases (Tauri makes them possible later; not tested now).

## Anti-goals

- Slow or heavy: must start fast and feel instant. No login, no onboarding wall.
- Losing the user's files: never delete a library file without explicit confirm;
  deleting an item moves its file to the OS recycle bin.
- Cluttered UI: a card shows only name, thumbnail, qty progress, material/colour
  chip. Details live in a side panel.

## Designed for later (must not be blocked)

- **Multiple printers:** data model has a `printers` table and a nullable
  `printer_id` on print status changes / items. v1 creates a single default
  printer and hides the selector.
- **Auto status from printer:** status changes go through a single backend
  function (`set_item_status`), so a future printer-polling module (Moonraker /
  Elegoo SDCP etc.) can call the same path.
- **Reading estimates from sliced 3MF:** metadata fields exist; a later parser
  can fill them.

## Constraints and decisions

- Stack (decided by user): **Tauri 2 + React + TypeScript**, Rust backend.
- Storage: SQLite database file inside the library folder (`planner.db`), so
  moving the library folder moves everything together.
- Delivery (decided by user): source in
  `github.com/BastienRoyM/3d-printer-planner` + GitHub Actions workflow producing
  a Windows `.msi`/`.exe` installer as a build artifact. Developer machine is a
  Mac; Windows behaviour is verified by the user.
- Supported file types: `.stl`, `.3mf`, `.obj`, `.step`/`.stp`, `.amf`, `.gcode`
  (thumbnail only for STL/3MF/OBJ).

## Data model (sketch)

- `projects(id, name, description, color, archived, created_at, sort)`
- `queues(id, project_id, name, sort, created_at)`
- `items(id, queue_id, name, status [todo|printing|done|failed], qty_total,
  qty_done, copies_per_plate, material, color, notes, est_minutes, est_grams,
  printer_id NULL, sort, created_at, updated_at)`
- `item_files(id, item_id, rel_path, kind [model|project|gcode], is_original,
  added_at)`
- `print_events(id, item_id, printer_id NULL, kind [started|finished|failed|
  reset], copies, at)` — *builder's call:* an append-only history written by
  `set_item_status`, so a future auto-status module and per-printer stats have
  data to build on. Shown as a small history list in the item side panel.
- `printers(id, name)` — one default row in v1
- `settings(key, value)` — slicer path, theme
- App-level config (outside the library, in AppData): library folder path.

Library layout: `<library>/projects/<project-slug>/<queue-slug>/<file>`;
name collisions get a ` (2)` suffix. Renaming a project/queue does not move
files (paths stored relative to the library root).

## Status behaviour

- Drag To do → Printing: status `printing`.
- "Print finished" on a Printing card: `qty_done += 1`; if `qty_done < qty_total`
  card returns to top of To do, else goes to Done.
- Failed: card goes to Failed column; "Retry" sends it back to To do.
- Manual drag to Done sets `qty_done = qty_total`.
- *Builder's call* for other moves: Done → To do keeps `qty_done` unless the user
  chooses "Reset progress" (sets 0); Printing → To do just cancels (logs nothing
  but a `reset` event); Failed → Done is treated like a drag to Done. A failure
  never decreases `qty_done`.

## Left to the builder

- Exact visual design, icons, fonts, spacing.
- Thumbnail rendering approach (e.g. three.js offscreen render cached as PNG).
- Drag-and-drop library choice.
- Rust crates and DB access layer.
