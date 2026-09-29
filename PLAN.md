# WorldVilla — Product & Build Plan

## Product thesis
A local-first desktop workspace for building fictional worlds and writing stories. A world is an ordinary folder users own: Markdown is the canonical content, JSON stores visual-layout data, and a local SQLite database provides a disposable/rebuildable index for fast search and relationship queries.

## Technology baseline

- **Desktop:** Electron
- **UI:** React, TypeScript, Vite
- **Editor:** CodeMirror 6
- **Desktop boundary:** context-isolated Electron preload API with typed IPC
- **Canonical workspace data:** Markdown + YAML frontmatter, JSON for map/canvas layouts
- **Index/search:** SQLite + FTS5 via `better-sqlite3`; it must always be rebuildable from workspace files
- **State/UI:** Zustand, TanStack Query, Zod
- **Later visual tools:** React Flow (genealogy/corkboard), Cytoscape.js (knowledge graph), Konva (maps/floor plans), dnd-kit (reordering)
- **Testing:** Vitest, React Testing Library, Playwright Electron tests
- **Packaging:** Electron Forge

## Non-negotiable principles

1. **Offline works forever.** No account, server, or internet connection required.
2. **Users own their data.** Lore and manuscript remain readable outside the app.
3. **Cross-platform consistency.** Use Electron's bundled Chromium; test macOS, Windows, and Linux from the beginning.
4. **Safe desktop boundary.** Node integration disabled in renderer; all filesystem/database work goes through narrow, typed IPC APIs.
5. **Stable IDs over filenames.** Titles and paths may change. Entity and scene IDs cannot.
6. **Index is derived data.** Deleting `.worldvilla/index.sqlite` never loses content.
7. **Model first, canvas second.** Family/map/story relationships are canonical records; visual canvases store only presentation position, size, and grouping.

---

# Phase 0 — Foundation and product contract

**Goal:** Establish a secure, testable desktop shell and a durable workspace format before feature development.

### Build
- Electron + React + TypeScript + Vite project setup.
- Secure preload API, typed IPC contracts, and no Node APIs in React renderer.
- Workspace create/open/recent-workspaces flow.
- File watcher and explicit rescan command.
- App layout shell: sidebar, main pane, optional inspector pane, command palette placeholder.
- `world.json` manifest and `.worldvilla/` application directory.
- Cross-platform CI matrix for macOS, Windows, and Linux.
- Test harnesses, formatter, linter, release/version conventions.

### Define the first file contracts

```text
My World/
  world.json
  lore/
  manuscript/
  media/
  maps/
  canvases/
  .worldvilla/
    index.sqlite
    snapshots/
    settings.json
```

```md
---
id: char_arya_stark
type: character
title: Arya Stark
status: alive
allegiance: faction_house_stark
tags: [pov, noble]
---

# Arya Stark

Arya is the daughter of [[Eddard Stark]].
```

### Done when
- A user can create, reopen, and move a workspace without corrupting it.
- The same starter workspace renders consistently on all three target OSes.
- The app has no renderer filesystem privileges.

---

# Phase 1 — Usable lore workspace (first private alpha)

**Goal:** Make note-taking and organization genuinely useful for a solo worldbuilder.

### Build
- File tree with unlimited nested folders; create, rename, move, delete.
- Markdown editor using CodeMirror 6.
- YAML frontmatter editing/validation and a basic property inspector.
- Entity templates: character, place, faction, item, event, generic note.
- Wiki-link parsing and autocomplete for `[[Internal Links]]`.
- Open linked entries, unresolved-link indicators, backlinks panel.
- SQLite indexer for documents, titles, IDs, frontmatter fields, links, and headings.
- Fast global full-text search with filters for type, tag, folder, and metadata.
- Autosave and recovery from interrupted writes.

### Explicitly defer
- Graph visualization, visual canvases, genealogy, timeline, sync, collaboration.

### Done when
- A user can maintain a sizeable lore wiki entirely offline.
- Renaming an entity updates inbound wiki links safely.
- Search and backlinks remain fast after a few thousand notes.

---

# Phase 2 — Manuscript and scene binder (first public alpha)

**Goal:** Support drafting a novel, game narrative, or screenplay alongside lore.

### Build
- Manuscript hierarchy: project → volume → part → chapter → scene.
- Scene Markdown documents with metadata: POV, in-world date, locations, characters, status, word count, tags.
- Binder view with drag-and-drop scene/chapter ordering.
- Scene editor with estimated and actual word counts.
- Corkboard/index-card view, backed by a JSON layout file.
- Split screen: two editable/read-only panes for scene + lore/reference.
- Global search across manuscript, lore, and frontmatter.
- Safe global rename preview (links, entity titles, selected metadata values).
- Snapshot versions: automatic timestamped revisions, restore, compare, and retention settings.
- Export a manuscript selection to Markdown and DOCX/HTML.

### Done when
- A writer can draft and reorder an entire book without leaving WorldVilla.
- They can inspect previous versions of any scene and restore one safely.
- A scene can reference lore without duplicating the lore content.

---

# Phase 3 — Story continuity, chronology, and character state

**Goal:** Catch continuity problems and let writers review story structure.

### Build
- Timeline configuration per project: one familiar Gregorian-style master timeline is the canonical reference for every event, with an author-defined story span from days to millennia. It provides the shared date and sortable day value writers can always reason about.
- Optional in-world time systems may overlay the master timeline: custom eras, non-Earth year/month/day structures, and alternate planetary clocks. Each maps to a master date rather than replacing it.
- Event records are time intervals, not only point dates: each has a required canonical master start date/time, optional master end date/time, and may additionally store/display a range in a chosen in-world time system. They link to scenes, entities, and required locations.
- Multi-track timeline with filterable lanes (plot, character, location, faction, volume), a zoomable scale appropriate to the configured story span, and interval bars. Overlapping or parallel events are valid and visually stacked rather than treated as contradictions.
- POV arc view: chronological scenes/events for one or more selected characters.
- Tags for subplot, foreshadowing, clue, reveal, and resolution.
- State-history records, starting with item ownership, character location, life status, and allegiance.
- Continuity queries, e.g. “Who held this item on date X?” and warnings for overlapping ownership.
- Custom calendar v1: eras, named periods and period lengths, configurable cycles/clocks, date arithmetic, conversion to/from the sortable story-time value, and display formatting.

### Data-model rule
Do not overwrite historical facts. Store a dated state transition:

```json
{
  "id": "state_longclaw_004",
  "subjectId": "item_longclaw",
  "field": "holderId",
  "from": "char_jeor_mormont",
  "to": "char_jon_snow",
  "effectiveDate": "298-08-14",
  "eventId": "event_gift_longclaw"
}
```

### Done when
- A writer can isolate a POV arc and identify gaps in that character’s chronology.
- The app can flag basic contradictions rather than merely display data.

---

# Phase 4 — Relationship graph and genealogy

**Goal:** Make complex character/faction relationships understandable at a glance.

### Build
- Interactive lore graph: node types, edge labels, filtering, focused neighborhoods, saved views.
- Relationship editor for parent, spouse/partner, adoption, guardian, rivalry, allegiance, membership, and ownership.
- Family-tree canvas supporting multiple partners, adoption, unknown parents, non-biological links, and annotations.
- Separate lineage/succession concepts so royal succession is not inferred only from parentage.
- JSON storage for canvas positions; structured entity relationship records remain canonical.
- Import/export for relationship data.

### Done when
- A user can navigate from a character through related houses, places, events, and artifacts.
- Complex dynasties can be represented without forcing them into a conventional binary family tree.

---

# Phase 5 — Maps, interiors, and travel

**Goal:** Connect geographic worldbuilding to story logistics.

### Build
- Image/SVG map import, pan/zoom, labeled pins, and map layers.
- Nested map links: world → region → city → building → floor plan.
- Map metadata and coordinate systems.
- Grid floor-plan canvas for buildings, rooms, walls, doors, levels, and secret passages.
- Character/location references on maps.
- Route creation with distances and terrain modifiers.
- Travel calculator using traveler, transport mode, speed, rest rules, and calendar date.
- Timeline/event integration for travel events.

### Done when
- Clicking a map pin can open its child map or referenced lore entry.
- Travel duration can be calculated reproducibly and inserted as an event.

---

# Phase 6 — Polish, extensibility, and release readiness

**Goal:** Turn the alpha into a trusted daily desktop application.

### Build
- Onboarding, example world, templates, keyboard shortcuts, command palette.
- Accessibility: keyboard canvas navigation, screen-reader labels, contrast, scalable UI.
- Performance work: incremental indexing, large-workspace benchmarks, virtualization.
- Backup/export/import/rebuild-index tools.
- Plugin or scripting API only if real user workflows justify it.
- Crash recovery, diagnostics bundle, logging with opt-in sharing.
- Auto-update strategy that never touches user workspaces.
- Signed installers and release channels.
- Comprehensive migration/version handling for workspace schemas.

### Done when
- Users can trust the app with years of writing.
- Every workspace can be opened, exported, backed up, and recovered without a service.

---

# Future (intentionally not in initial roadmap)

- Official synchronization and conflict resolution.
- Collaboration and live co-editing.
- Mobile apps.
- AI writing/generation features.
- Marketplace/community sharing.

These should be additive: a fully offline folder must remain valid and usable without them.

# Recommended execution cadence

1. Complete Phase 0 before designing detailed canvases.
2. Release Phase 1 to a small group of lore-heavy writers.
3. Release Phase 2 before tackling graph/maps: drafting workflow is the product's daily-use core.
4. Use feedback to prioritize Phase 3, 4, or 5 rather than assuming every advanced module is equally urgent.
5. Keep every milestone independently shippable and compatible with existing workspace files.
