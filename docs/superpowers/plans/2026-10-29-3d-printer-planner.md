# 3D Printer Planner v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri 2 desktop app (Windows first) to organise 3D-print files into Projects → Queues → Items, track them on a Kanban board, and open them in the user's slicer.

**Architecture:** Rust backend owns all state: an SQLite DB (`planner.db`) and model files both live in the library folder; a file watcher attaches slicer-saved files to items. React + TypeScript frontend talks to it only through typed `invoke` wrappers in `src/api.ts` and refetches on the backend event `library-changed`. Status changes all go through one Rust function (`status::apply`) that also appends to `print_events`.

**Tech Stack:** Tauri 2, Rust (rusqlite bundled, notify + notify-debouncer-mini, trash, dirs, serde, thiserror, tempfile for tests), React 18 + TS + Vite, @dnd-kit/core + @dnd-kit/sortable, three (STL/3MF/OBJ loaders), lucide-react, vitest, @tauri-apps/plugin-dialog.

**Spec:** `docs/superpowers/specs/2026-10-29-3d-printer-planner-design.md`

## Global Constraints

- App name "3D Printer Planner"; identifier `com.bastienroym.printerplanner`.
- Default library: `<Documents>/3D Planner`; library layout `<library>/projects/<project-slug>/<queue-slug>/<file>`; DB at `<library>/planner.db`.
- App config (library path only) at `<config_dir>/3d-printer-planner/config.json`.
- Supported import extensions: `stl, 3mf, obj, step, stp, amf, gcode` (case-insensitive). Thumbnails only for `stl, 3mf, obj`.
- Name collision on import: `name (2).ext`, `name (3).ext`, …
- Statuses: `todo | printing | done | failed`. Event kinds: `started | finished | failed | reset`.
- Never hard-delete user files: item/queue/project deletion sends files to the OS recycle bin (`trash` crate).
- Dark theme default, light toggle persisted in `settings` (`theme` key).
- One default printer row (id 1, "My printer"); UI hides printer selection.
- No push, no PR. Commit locally on branch `v1`.

## Review Focus

1. Dropping a file whose name already exists in the queue folder → copied as `name (2).ext`, never overwrites (test in Task 3).
2. Slicer writes `bracket.gcode.3mf` / `bracket_plate_1.gcode` next to `bracket.stl` → attached to `bracket`, not to a sibling `bracket_long` item; longest stem wins (test in Task 5).
3. "Print finished" with copies_per_plate 3 and 2 remaining → qty_done capped at total, card goes to Done (test in Task 4).
4. Dropping an unsupported file (e.g. `.png`) or a folder → skipped and reported, others still imported (test in Task 3).
5. Moving the library to a non-empty folder → refused with a clear error; old library untouched (test in Task 6).

---

## File Structure

```
src-tauri/
  Cargo.toml, tauri.conf.json, capabilities/default.json, build.rs
  src/main.rs          – calls lib::run()
  src/lib.rs           – builder, state, plugin + command registration, watcher start
  src/error.rs         – AppError (thiserror) serialised as string
  src/config.rs        – AppConfig load/save, default library path
  src/db.rs            – open(path) + migrate(conn)
  src/models.rs        – serde structs shared by commands
  src/library.rs       – slugify, unique_path, import copy, move_library
  src/repo.rs          – CRUD for projects/queues/items/item_files + summaries
  src/status.rs        – status transitions + print_events
  src/sync.rs          – derived-file matching, queue folder sync, unassigned list
  src/watcher.rs       – debounced notify watcher → sync → emit "library-changed"
  src/slicer.rs        – detect ElegooSlicer, launch, reveal in explorer
  src/commands.rs      – #[tauri::command] wrappers
src/
  main.tsx, App.tsx, styles.css
  api.ts               – types + invoke wrappers
  lib/progress.ts      – pure progress/total helpers (+ progress.test.ts)
  lib/format.ts        – minutes/grams formatting (+ format.test.ts)
  lib/thumbnail.ts     – three.js offscreen render → PNG data URL
  hooks/useLibrary.ts  – data loading + "library-changed" listener
  components/Sidebar.tsx, ProjectView.tsx, QueueBoard.tsx, ItemCard.tsx,
             ItemPanel.tsx, SettingsDialog.tsx, Thumbnail.tsx, Modal.tsx,
             ProgressBar.tsx
.github/workflows/build-windows.yml
README.md
```

---

### Task 1: Scaffold Tauri 2 + React app

**Files:** Create everything under `src-tauri/`, `src/`, `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`.

- [ ] **Step 1:** Scaffold with `npm create tauri-app@latest` (react-ts, npm) into a temp dir and move into the repo root; set productName/identifier from Global Constraints; window 1280×800, min 900×600, title "3D Printer Planner"; `dragDropEnabled: true`.
- [ ] **Step 2:** Add Rust deps: `rusqlite = { features = ["bundled"] }`, `serde`, `serde_json`, `thiserror`, `dirs`, `trash`, `notify`, `notify-debouncer-mini`, `tauri-plugin-dialog`; dev-dep `tempfile`. Add npm deps listed in Tech Stack, plus `vitest`. Register dialog plugin; capability allows `dialog:default`, `core:event:default`.
- [ ] **Step 3:** Verify: `cd src-tauri && cargo build` succeeds; `npx tsc --noEmit` and `npx vite build` succeed.
- [ ] **Step 4:** Commit `chore: scaffold Tauri 2 + React app`.

### Task 2: Config, DB schema, models

**Files:** `src-tauri/src/{error,config,db,models}.rs`

**Interfaces – Produces:**
- `AppError` enum (`Db`, `Io`, `NotFound(String)`, `Invalid(String)`), `impl Serialize` as its Display string; `type AppResult<T> = Result<T, AppError>`.
- `config::AppConfig { library_path: PathBuf }`, `config::load(config_file: &Path) -> AppConfig` (default `dirs::document_dir()/3D Planner` when missing/broken), `config::save(config_file: &Path, &AppConfig) -> AppResult<()>`.
- `db::open(path: &Path) -> AppResult<Connection>` (creates file, `PRAGMA foreign_keys=ON`, runs `migrate`), `db::migrate(&Connection)` using `PRAGMA user_version`.
- Tables exactly per spec data model, plus `queues.folder_rel TEXT NOT NULL`, `items.thumbnail TEXT NULL` (PNG data URL), `projects.color TEXT`, FKs `ON DELETE CASCADE`. Seed `printers(1,'My printer')`.
- `models.rs`: `Project`, `ProjectSummary { project, total_prints, done_prints, items_total, items_done, remaining_minutes, remaining_grams }`, `Queue`, `QueueSummary { queue, total_prints, done_prints, printing_count, next_item: Option<Item> }`, `Item` (all item columns + `files: Vec<ItemFile>`), `ItemFile`, `PrintEvent`, `ItemPatch` (all optional editable fields: name, qty_total, qty_done, copies_per_plate, material, color, notes, est_minutes, est_grams). All `#[serde(rename_all = "camelCase")]`.

- [ ] **Step 1: Failing tests** in `db.rs`: `migrate_is_idempotent` (open twice on same tempfile → no error, `user_version == 1`); `default_printer_seeded` (count of printers == 1). In `config.rs`: `load_missing_returns_default` (path ends with `3D Planner`), `save_then_load_roundtrip`.
- [ ] **Step 2:** `cargo test` → FAIL (not defined).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test` → PASS.
- [ ] **Step 5:** Commit `feat: config, db schema and models`.

### Task 3: Library files + repository CRUD + import

**Files:** `src-tauri/src/{library,repo}.rs`

**Interfaces – Produces:**
- `library::slugify(&str) -> String` (lowercase ascii, non-alnum → `-`, trimmed, empty → `untitled`).
- `library::unique_path(dir: &Path, file_name: &str) -> PathBuf`.
- `library::is_supported(path: &Path) -> bool`; `library::file_kind(name: &str) -> &'static str` → `"gcode"` for `.gcode`/`.gcode.3mf`, `"project"` for `.3mf`, else `"model"`.
- `repo::create_project(conn, lib, name, description: Option<String>, color: Option<String>) -> AppResult<Project>`, `update_project(conn, id, name, description, color, archived)`, `list_projects(conn) -> Vec<ProjectSummary>`, `delete_project(conn, lib, id)` (trash folder).
- `repo::create_queue(conn, lib, project_id, name) -> Queue` (creates folder `projects/<project-slug>/<queue-slug>`, unique via suffix `-2` if exists), `rename_queue`, `list_queues(conn, project_id) -> Vec<QueueSummary>`, `delete_queue(conn, lib, id)`.
- `repo::import_files(conn, lib, queue_id, paths: &[PathBuf]) -> AppResult<ImportResult { imported: Vec<Item>, skipped: Vec<String> }>` — copies, creates item (name = file stem, qty 1, cpp 1, status todo, sort at end of To do), original `item_files` row `is_original=1`.
- `repo::get_item(conn, id) -> Item`, `list_items(conn, queue_id) -> Vec<Item>` ordered by status then sort, `update_item(conn, id, &ItemPatch) -> Item` (clamps `qty_done` to `[0, qty_total]`, `qty_total >= 1`, `copies_per_plate >= 1`), `delete_item(conn, lib, id)` (trash each file), `set_thumbnail(conn, id, data_url)`, `reorder(conn, item_id, status, index)` (rewrites `sort` 0..n within that queue+status).
- Project summary math: total_prints = Σ qty_total, done_prints = Σ qty_done; remaining_minutes = Σ est_minutes × ceil((qty_total−qty_done)/copies_per_plate) over items with est set; same for grams but × (qty_total−qty_done)/copies_per_plate … use per-plate estimates: **est_minutes and est_grams are per plate**; remaining = est × plates_remaining where `plates_remaining = ceil((qty_total−qty_done)/copies_per_plate)`.

- [ ] **Step 1: Failing tests** (`tempfile::tempdir()` library, in-memory-equivalent DB in it):
  - `slugify_basic`: `"My Helmet!! v2"` → `"my-helmet-v2"`; `""` → `"untitled"`.
  - `import_copies_and_creates_item`: import `bracket.stl` → file exists under queue folder, item name `bracket`, one original file.
  - `import_name_collision_gets_suffix`: importing two different `bracket.stl` sources → second stored as `bracket (2).stl`, first file content unchanged.
  - `import_skips_unsupported`: paths `[a.stl, b.png, <dir>]` → 1 imported, skipped contains `b.png` and the dir.
  - `update_item_clamps`: qty_total 2, set qty_done 5 → 2.
  - `project_summary_remaining`: item qty 4, cpp 2, done 1, est_minutes 60 → remaining_minutes 120.
- [ ] **Step 2:** `cargo test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cargo test` → PASS.
- [ ] **Step 5:** Commit `feat: library import and repository`.

### Task 4: Status transitions + print history

**Files:** `src-tauri/src/status.rs`

**Interfaces – Produces:**
- `enum Action { Start, Finish, Fail, MoveTo(Status), ResetProgress }` (serde tagged from frontend as `{ "type": "start" } | { "type": "moveTo", "status": "done" }` …).
- `status::apply(conn, item_id, action, index: Option<usize>) -> AppResult<Item>` — the single entry point for status changes; writes `print_events` with `printer_id = 1`; then `repo::reorder` to `index` (default: top of To do for Finish-not-complete/Retry, end of target column otherwise).
- `status::history(conn, item_id) -> Vec<PrintEvent>` newest first.

Rules (from spec):
- Start / MoveTo(Printing): status printing; event `started`, copies = copies_per_plate.
- Finish: added = min(cpp, total−done); done += added; event `finished` copies=added; status = done if done == total else todo (top).
- Fail / MoveTo(Failed): status failed; event `failed` copies = cpp; qty_done unchanged.
- MoveTo(Todo): from printing → event `reset` copies 0; from failed/done → no event; qty_done kept.
- MoveTo(Done): event `finished` copies = total−done (skip event if 0); done = total.
- ResetProgress: done = 0, status todo, event `reset`.
- Same-status MoveTo = reorder only, no event.

- [ ] **Step 1: Failing tests:** `start_logs_started`; `finish_partial_returns_to_top_of_todo` (qty 4, cpp 1, another todo item exists → status todo, sort 0, done 1); `finish_caps_at_total` (qty 5, done 3, cpp 3 → done 5, status done, event copies 2); `fail_keeps_done`; `drag_to_done_sets_total`; `printing_to_todo_logs_reset`; `same_column_move_no_event`; `reset_progress_zeroes`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: status transitions with print history`.

### Task 5: Slicer-file sync + watcher

**Files:** `src-tauri/src/{sync,watcher}.rs`

**Interfaces – Produces:**
- `sync::match_item<'a>(file_name: &str, originals: &'a [(i64, String)]) -> Option<i64>` — originals are `(item_id, original_stem)`. Strip all extensions known (`.gcode.3mf`, then single ext) to get the candidate stem; match if candidate == stem or candidate starts with stem followed by one of `_ - . space (`; longest stem wins.
- `sync::is_ignored(file_name) -> bool` — starts with `.` or `~`, ends with `.tmp`/`.part`/`.bak`, or unsupported extension.
- `sync::sync_queue(conn, lib, queue_id) -> AppResult<bool>` (true if anything attached); untracked supported files matching an item → `item_files` with `file_kind`, `is_original=0`. Also removes `item_files` rows whose file no longer exists (except originals).
- `sync::unassigned(conn, lib, queue_id) -> Vec<String>` (file names in folder, not tracked, not ignored).
- `repo::attach_file(conn, item_id, file_name)`, `repo::item_from_file(conn, lib, queue_id, file_name) -> Item` (in repo.rs).
- `repo::open_target(item) -> &ItemFile` — newest `project` kind file by `added_at`, else original.
- `watcher::start(app: AppHandle, lib: PathBuf) -> AppResult<Debouncer<…>>` — debounce 800 ms, recursive on `<lib>/projects`; for each event path find queue by `folder_rel` prefix, `sync_queue`, emit `library-changed` (always, cheap).
- `list_items` calls `sync_queue` first.

- [ ] **Step 1: Failing tests:** `match_gcode_3mf` (`bracket.gcode.3mf` → bracket); `match_plate_suffix` (`bracket_plate_1.gcode` → bracket); `longest_stem_wins` (items `bracket`, `bracket_long`; `bracket_long.3mf` → bracket_long); `no_false_prefix` (`bracketry.3mf` → None); `ignored_temp_files`; `sync_attaches_and_open_target_prefers_newest_project` (write `bracket.3mf` into folder → sync → open_target is the .3mf); `unassigned_lists_unknown` (`other.stl` listed).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: attach slicer-saved files and watch library`.

### Task 6: Slicer launch, library move, commands wiring

**Files:** `src-tauri/src/{slicer,commands,lib}.rs`, `library.rs` (move)

**Interfaces – Produces:**
- `slicer::detect() -> Option<PathBuf>` — on Windows check `%ProgramFiles%\ElegooSlicer\` for `elegoo-slicer.exe`, `ElegooSlicer.exe`, else any `*.exe` containing `slicer` (case-insensitive); other OS `None`.
- `slicer::launch(slicer: Option<&Path>, file: &Path) -> AppResult<()>` — spawn slicer with file arg; if none configured/detected, open with OS default (`cmd /C start "" file`, `open`, `xdg-open`).
- `slicer::reveal(path)` — `explorer /select,` / `open -R` / `xdg-open dir`.
- `library::move_library(from, to) -> AppResult<()>` — refuse if `to` exists and is non-empty or is inside `from`; try `fs::rename`, else recursive copy then `remove_dir_all(from)`.
- `lib.rs` state: `struct AppState { inner: Mutex<Inner> }`, `Inner { conn, lib, config_file, watcher }`.
- Commands (camelCase args in TS): `get_app_info -> AppInfo { libraryPath, slicerPath, detectedSlicer, theme }`, `set_setting(key, value)`, `move_library(newPath)` (closes conn, stops watcher, moves, saves config, reopens, restarts watcher), `list_projects`, `create_project`, `update_project`, `delete_project`, `list_queues(projectId)`, `create_queue`, `rename_queue`, `delete_queue`, `list_items(queueId)`, `import_files(queueId, paths)`, `update_item(id, patch)`, `item_action(id, action, index?)`, `delete_item`, `item_history(id)`, `list_unassigned(queueId)`, `attach_file(itemId, fileName)`, `item_from_file(queueId, fileName)`, `open_in_slicer(itemId)`, `reveal_item(itemId)`, `read_model(itemId) -> tauri::ipc::Response` (bytes of original), `save_thumbnail(itemId, dataUrl)`.
- Slicer path stored in `settings` key `slicer_path`.

- [ ] **Step 1: Failing tests:** `move_library_refuses_non_empty` (target has a file → Err, source still has planner.db); `move_library_moves` (to fresh path → db exists at new, old gone).
- [ ] **Step 2:** FAIL. **Step 3:** Implement module + commands + registration.
- [ ] **Step 4:** `cargo test` PASS and `cargo build` succeeds.
- [ ] **Step 5:** Commit `feat: slicer launch, library move, tauri commands`.

### Task 7: Frontend foundation (api, theme, layout, sidebar, settings)

**Files:** `src/api.ts`, `src/styles.css`, `src/App.tsx`, `src/hooks/useLibrary.ts`, `src/lib/{progress,format}.ts` (+ tests), `src/components/{Sidebar,SettingsDialog,Modal,ProgressBar}.tsx`

**Interfaces – Produces:**
- `api.ts`: TS types mirroring models (camelCase) and one async function per command, same names in camelCase (`listProjects()`, `itemAction(id, action, index?)`, …), `onLibraryChanged(cb): Promise<UnlistenFn>`.
- `progress.ts`: `percent(done: number, total: number): number` (0 when total 0, rounded int, max 100); `platesRemaining(item): number`.
- `format.ts`: `formatMinutes(m: number|null): string` (`95` → `"1h 35m"`, `40` → `"40m"`, null → `"—"`), `formatGrams(g)` (`1250` → `"1.25 kg"`, `80` → `"80 g"`).
- Layout: left sidebar (projects list with progress ring/bar, "+ New project", archived collapsed, settings gear at bottom); main area routes via state `{ view: 'project', projectId } | { view: 'queue', projectId, queueId }`.
- CSS tokens on `:root[data-theme=dark|light]`; font stack `"Segoe UI Variable", "Segoe UI", Inter, system-ui`.
- Settings: library path + "Move…" (directory dialog), slicer path + "Browse…" (exe filter on Windows) + detected hint, theme toggle.

- [ ] **Step 1: Failing tests** `progress.test.ts`, `format.test.ts` with the values above.
- [ ] **Step 2:** `npx vitest run` → FAIL. **Step 3:** Implement helpers + UI. **Step 4:** vitest PASS, `npx tsc --noEmit` PASS.
- [ ] **Step 5:** Commit `feat: frontend shell, sidebar and settings`.

### Task 8: Project overview + queue Kanban board

**Files:** `src/components/{ProjectView,QueueBoard,ItemCard,Thumbnail}.tsx`, `src/lib/thumbnail.ts`

- ProjectView: header (name, editable description, overall progress, remaining time/grams), grid of queue cards (name, progress bar, printing count, **Next up** item with "Open in slicer" button), "+ New queue", rename/delete via menu.
- QueueBoard: four columns To do / Printing / Done / Failed using @dnd-kit sortable; drop → `itemAction(id, {type:'moveTo', status}, index)`. Toolbar: "Add files" (dialog, multi, filter by supported extensions), drop-zone overlay on Tauri `onDragDropEvent` (`over` → overlay, `drop` → `importFiles(queueId, paths)`), toast for skipped files, unassigned-files banner.
- ItemCard: thumbnail, name, `qtyDone/qtyTotal` mini-bar, material/colour chip; quick buttons per column: To do → ▶ Start + Open in slicer (top card highlighted "Next up"); Printing → ✓ Finished / ✕ Failed; Failed → ↺ Retry.
- `thumbnail.ts`: `renderThumbnail(bytes: ArrayBuffer, ext: 'stl'|'3mf'|'obj', size = 256): Promise<string>` — single shared offscreen WebGLRenderer, auto-fit camera iso view, neutral material; Thumbnail component renders lazily via a serial queue when `item.thumbnail` is null and ext supported, then `saveThumbnail`.

- [ ] **Step 1:** Implement. **Step 2:** `npx tsc --noEmit` and `npx vite build` PASS. **Step 3:** Commit `feat: project overview and kanban board`.

### Task 9: Item side panel

**Files:** `src/components/ItemPanel.tsx`

- Slide-in panel on card click: editable name, qty total, done (number), copies per plate, material, colour, est time per plate (min), est grams per plate, notes (textarea); save on blur via `updateItem`. Files list (kind badge, original marker, open-target marker); buttons Open in slicer, Show in folder, Reset progress, Delete (confirm in-app modal, mentions recycle bin). History list from `itemHistory`.
- Unassigned banner actions: attach to item (select) or create item.

- [ ] **Step 1:** Implement. **Step 2:** tsc + vite build PASS. **Step 3:** Commit `feat: item details panel`.

### Task 10: CI, README, final verification

**Files:** `.github/workflows/build-windows.yml`, `README.md`

- Workflow on `push` (branches main, v1; tags `v*`) and `workflow_dispatch`, `windows-latest`: setup node 22, rust stable, `npm ci`, `npx vitest run`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run tauri build`, upload `src-tauri/target/release/bundle/msi/*.msi` and `nsis/*.exe` as artifact `windows-installer`. On tag: `softprops/action-gh-release` attaching them.
- README: what it is, install (SmartScreen note), dev commands, library layout.

- [ ] **Step 1:** Write files. **Step 2:** Full local verification: `cargo test`, `npx vitest run`, `npx tsc --noEmit`, `npm run tauri build -- --debug` on macOS compiles. **Step 3:** Commit `ci: windows installer build`.
