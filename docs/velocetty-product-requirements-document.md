# Velocetty product requirements document

This document defines the current product stance and workstreams for
Velocetty. It treats the command and shortcut system, and the tab-handle
customization surface, as first-class requirements that shape the surrounding
architecture and user experience.

## Product stance

Velocetty is a new terminal that reuses useful work from Hyper/Vercel where it
helps, without targeting backwards compatibility. This stance permits a
coherent command system, a first-class settings user experience, and a plugin
architecture that does not rely on internal implementation details.

A core design mantra is: “Everything the app can do is a command.” Keybindings,
menus, buttons, the command palette, and remote control therefore become
consistent views over the same underlying surface.

## Workstreams and deliverables

### 0) Foundation and scaffolding

Keep the earlier foundations, plus one extra decision needed early: a “command
bus” abstraction that both core and plugins can use, spanning frontend and
backend.

Deliverables:

- Repo layout: `frontend/`, `backend/`, `shared/` (types, protocol, schemas).

- CI: lint/typecheck/tests/builds.

- Basic instrumentation (input latency, frame timing, context allocation).

- A “golden path” example plugin that exercises commands + settings + tab
  decoration.

### 1) Rendering: WebGL only for visible panes

Unchanged goal, but with a specific interface boundary: rendering should
consume a “pane model” that can also feed tab decorations (process name, cwd,
activity state) without plugins spelunking UI internals.

Deliverables:

- Visibility-aware render scheduler and WebGL context manager.

- Deterministic fallbacks and context-loss handling.

- Benchmarks and performance counters.

### 2) Configuration: move to JSON5

JSON5 becomes the canonical format for:

- App configuration

- Keybindings

- Plugin-contributed settings (namespaced)

- Optional tab decoration preferences (if user configurable)

Deliverables:

- JSON5 loader + validation + clear error reporting.

- Layering rules (defaults → user config → runtime overrides).

- Hot-reload semantics defined (what reloads live, what needs restart).

### 3) Command system and keybinding management (new, first-class workstream)

This is the “VS Code / Windows Terminal / Obsidian” part: a normalized command
registry, a dispatcher, a keybinding engine, and a UI to manage it.

Deliverables (core):

- Command registry:

- Stable command IDs (`terminal.splitPane`, `tab.close`,
  `workspace.openSettings`, etc.)

- Metadata: title, category, description, icon (optional), searchable keywords.

- Enablement/visibility conditions (“when” clauses) driven by context keys.

- Optional argument schema (so commands can be invoked programmatically and
  validated).

- Command dispatcher:

- Single invocation path used by keyboard shortcuts, command palette, menus,
  buttons, and plugin calls.

- Supports async commands and cancellation semantics where sensible.

- Keybinding engine:

- Supports chords (e.g. `Ctrl+K Ctrl+S`) to match VS Code parity.

- Context-aware resolution using “when” expressions (e.g.
  `terminalFocus && !findWidgetVisible`).

- Conflict detection and deterministic precedence rules.

- Layering: defaults → user overrides (JSON5) → optional workspace overrides.

- Command palette:

- Fast fuzzy search, categories, recently used.

- Shows active keybinding(s) for each command.

- Works with command arguments (either prompts or typed UI).

- Keybinding editor UI:

- Search commands, set/remove bindings, show conflicts, export/import (still
  JSON5 canonical).

- Clear affordances for “reset to defaults”.

Deliverables (plugin hooks):

- Plugins can register commands through a stable API surface:

- `registerCommand(id, metadata, handler)`

- `registerKeybindings([{ commandId, keys, when }])` (or contribute defaults
  via manifest/schema)

- Plugins can contribute context keys (or subscribe to existing ones) so
  shortcuts can be conditional in meaningful ways.

- Plugins can expose commands to the palette automatically, with an option to
  hide them unless explicitly enabled.

Security/architecture notes that matter later:

- A command is the perfect choke-point for permissioning once a remote frontend
  exists. If a backend-owned command implies privileged access (filesystem,
  PTY spawning, credentials), the command invocation should traverse a
  permission-aware boundary even if it originated in the local UI.

### 4) Settings tab + plugin settings panels (with security posture explicit)

The settings tab remains, but now it *must* integrate with the command system:
“Open Settings”, “Search Settings”, “Reset Setting”, “Export Config”, “Open
Keybindings”, etc. should all be commands.

Deliverables:

- Settings UI shell with search, categories, validation, reset-to-default.

- Plugin settings contributions via:

- Schema-driven panels as the safe default.

- Optional arbitrary React panels as an explicit opt-in with a stated security
  model (trusted vs sandboxed).

### 5) Schema-driven settings panels for plugins

Same as before, but tightened around the command system:

- Schema can declare settings fields *and* optional commands (e.g. “Test
  connection”, “Clear cache”, “Re-index”), so plugins don’t invent bespoke UI
  glue.

Deliverables:

- Settings schema format (UI hints + validation + defaults).

- Auto-generated panels and consistent UX controls.

- Namespaced persistence into JSON5.

### 6) Vertical tabs + rich tab content + clean tab-handle customization hooks (expanded)

This revision treats tab handles themselves as an extensibility surface, without
plugins mucking with layout internals.

The key is to treat the tab handle as a composition of “slots” with
well-defined data inputs and merge rules, rather than “here’s a React
component, good luck”.

Deliverables (core):

- Vertical tab rail and rich tab content (pinning, grouping, reorder, activity
  indicators).

- Tab model and state lifecycle (activate/deactivate, serialize/restore).

Deliverables (tab handle customization API):

- A “Tab Decoration API” that exposes stable slots, for example:

- Primary icon

- Primary title text

- Secondary line/subtitle (optional)

- Badges (e.g. exit code, bell indicator, git branch)

- Right-side widgets (careful: keep this constrained to avoid performance/UI
  chaos)

- Providers, not overrides:

- Plugins register “decoration providers” that receive a read-only context (tab
  id, active pane id, process info, cwd, activity/bell state, maybe last
  command) and return partial decorations.

- The host merges contributions deterministically (priority + explicit conflict
  rules).

- Performance discipline:

- Decoration updates should be event-driven (process changed, cwd changed, tab
  focus changed), not polling.

- Providers may be async, but with caching and timeouts so a slow plugin doesn’t
  stall tab rendering.

- User control:

- Settings to enable/disable specific decoration providers and define
  precedence (“prefer process icon plugin over default icon”).

- Optional per-provider settings surfaced through the schema-driven settings
  system.

Examples this directly supports:

- “Icon based on what’s running”: provider maps process name to icon.

- “Second line shows CWD”: provider adds subtitle = cwd (with truncation rules).

- More exotic: show git branch for cwd, show SSH host, show container name —
  all without breaking the host.

Security note:

- Tab decoration providers are a surprisingly sensitive surface once remote UI
  exists, because they can leak information (paths, hostnames). A redaction and
  permission model is required for metadata exposed to a remote frontend.

### 7) Move host to Tauri

Same direction, but now with clearer boundaries:

- Frontend invokes commands; privileged commands route to the backend.

- Backend owns PTY/process/filesystem; frontend remains a UI client.

Deliverables:

- Tauri host with stable IPC mapped onto the command system where appropriate.

- Packaging, platform integration, update strategy.

### 8) Frontend/backend segregation + remote frontend + protobuf/WebSocket comms

This becomes cleaner because commands already exist as the canonical “intent”
layer.

Deliverables:

- Backend service mode (headless/local).

- Protobuf-defined protocol:

- Terminal streams (pty I/O)

- UI state sync where needed

- Command invocation messages (with auth + permission checks)

- WebSocket transport with multiplexing.

- Authentication and authorization model for remote attachment.

- Capability negotiation (local Tauri UI can do X; remote browser UI can do Y).

## Updated sequencing (phases with crisp exit criteria)

Phase 1: Architecture skeleton

Basic terminal session, repo structure, CI, instrumentation.

Phase 2: Rendering overhaul

Visible-only WebGL; stable multi-pane; measurable latency improvements.

Phase 3: JSON5 + command system + keybindings (do these together)

Config is canonical; command palette exists; keybinding editor works; plugins
can register commands safely; UI actions route through commands.

Phase 4: Settings tab + schema-driven plugin settings

Settings UX complete; plugins add settings panels; settings can trigger
commands.

Phase 5: Vertical tabs + tab handle decoration API

Vertical tabs ship; plugin providers can influence icon/title/subtitle/badges
deterministically and performantly.

Phase 6: Tauri host integration

Desktop host solid, backend owns privileged ops, packaging pipeline in place.

Phase 7: Remote frontend + protocol

Browser UI can attach; protobuf/WebSocket comms stable and versioned;
auth/permissions defined.

## A couple of design “gotchas” worth nailing early

The command “when” system should keep context keys explicit and testable, such
as
`terminalFocus`, `paneCount > 1`, `findOpen`, `settingsOpen`, or
`tabType == "terminal"`, instead of ad-hoc booleans scattered through
components.

Tab decoration merge rules should be defined up-front. For example, when two
plugins provide icons, the rules should clarify whether priority wins, stacking
(badge + icon) is permitted, or dual icons are disallowed to avoid ambiguous
UX.

The revised high-level plan remains high level, but it now surfaces the right
pressure points so the PRD and tech design can lock decisions early instead of
discovering them mid-implementation.
