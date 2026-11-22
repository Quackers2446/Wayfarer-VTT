# Wayfarer · 5e Campaign Desk & Virtual Tabletop

[![Standard 5e SRD](https://img.shields.io/badge/5e%20Rules-2014%20%26%202024%20SRD-2d4939.svg)](#)
[![Zero Build Solo Play](https://img.shields.io/badge/Architecture-Client--First%20Vanilla%20ESM-e8cc8b.svg)](#)
[![Edge Multiplayer](https://img.shields.io/badge/Multiplayer-Cloudflare%20D1%20%2B%20R2-orange.svg)](#)
[![Live on Cloudflare](https://img.shields.io/badge/Live-wayfarer--vtt.pages.dev-blue.svg)](https://wayfarer-vtt.pages.dev/)

**Wayfarer** is a client-first 5th Edition D&D campaign organizer and virtual tabletop (VTT). It imports character workbooks, derives official rules, indexes published adventures from 5etools archives, and provides a tactical 2D grid engine with line-of-sight fog of war, automated spell zones, and autonomous monster AI.

- **Live Production App**: [https://wayfarer-vtt.pages.dev/](https://wayfarer-vtt.pages.dev/)
- For an in-depth breakdown of every subsystem, algorithm, and file, see [WAYFARER_EXPLAINED.md](WAYFARER_EXPLAINED.md).

---

## Quick Start (Run Locally)

Wayfarer runs with any static web server. A Python development server is included that enables direct local access to adjacent character workbooks and 5etools ZIP archives:

```bash
cd wayfarer
python3 scripts/serve.py
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/) in your web browser.

- On the **Character sheets** page, click **Import supplied sheets** to load sample workbooks from the adjacent `Character Sheets` directory.
- On the **Play** page, click **Use supplied archive** to load map data and creature art from the adjacent `5etools-v*.zip`.

---

## Key Features

### 1. Character Workbook Ingestion & Rules Engine
- **Excel & Google Sheets**: Drag-and-drop `.xlsx` files or paste public Google Sheets URLs. Supports complex template sheets (v1.3, v1.4, MPMB) and simple key-value sheets.
- **Automated Rule Derivation**: Computes Proficiency Bonus, ability modifiers, saving throws, AC based on worn armor categories and shields, passive Perception, walking speed, darkvision, and multiclass spell slots.
- **Custom Token Portraits**: Upload custom square PNG, JPEG, or WebP portraits; tokens automatically crop and sync across players.
- **Sheet Editor**: Live editing for class levels, subclasses, feats, skill training ranks (Untrained, Proficient, Expertise), worn equipment, and spell slot pools.

### 2. 5etools Archive & Adventure Library
- **Offline IndexedDB Storage**: Attaches 5etools ZIP releases directly in the browser without re-uploading on refresh.
- **Searchable Catalog**: Filter official adventures and sourcebooks by title, series, and recommended party level (1–20).
- **Map & Chapter Indexes**: Access chapter breakdowns and map lists (identifying DM maps vs. player maps).

### 3. Tactical Virtual Tabletop (VTT)
- **Computer Vision Grid Snapping**: Auto-aligns the tactical 5-foot grid to printed battle map artwork using image luminance edge detection.
- **Fog of War & Line of Sight**: Raycasted field-of-view taking into account darkvision, walls, and vision-blocking screens. Explored terrain is saved compactly using binary bitsets.
- **A\* Movement & Opportunity Attacks**: Pathfinding accounts for difficult terrain, prone penalties, and wall barriers. Moving out of enemy melee reach automatically triggers real-time opportunity attacks.
- **Automated Spell Mechanics**: AoE sphere flood-fills, cone projections, and concentration tracking for spells including *Fireball*, *Misty Step*, *Magic Missile*, *Sleep*, *Aid*, *Witch Bolt*, *Fog Cloud*, and *Darkness*.
- **Autonomous Hostile Monster AI**: Enemy creatures stand from prone, approach targets, dash when distant, use Nimble Escape, resolve multiattack routines, and dodge when idle.
- **Story Journal**: Automatically reads room polygon entries and surfaces DM read-aloud boxed text as the party explores. Freeing captives like Sildar Hallwinter updates the campaign story journal.

### 4. Multiplayer Campaign Tables
- **Edge Architecture**: Powered by Cloudflare Workers, D1 SQLite database, and R2 image storage.
- **Optimistic Concurrency**: Fast turn state synchronization with conflict reconciliation.
- **Party Seats**: Up to 4 players can claim character seats and control their cameras independently.
- **Party Chat**: Integrated chat with 200-message scrollback, unread badges, and speaker attribution.

---

## Project Layout

```
wayfarer/
├── dist/                  # Web app root (served locally or deployed)
│   ├── index.html         # SPA entry point
│   ├── app.mjs            # Client router and state coordinator
│   ├── combat.mjs         # 5e rules, rolls, and pathfinding
│   ├── grid-view.mjs      # HTML5 Canvas 2D grid & fog renderer
│   ├── enemy-turn.mjs     # Automated enemy AI
│   ├── play.mjs           # Tactical table controller
│   └── ...                # Modular ES components and CSS
├── worker/
│   └── session.mjs        # Cloudflare Worker multiplayer API
├── drizzle/               # D1 SQL migration scripts
└── scripts/
    ├── serve.py           # Local dev server
    ├── build.mjs          # Wrangler distribution packaging
    ├── build-catalog.py   # Adventure index generator
    └── build-rules.py     # 5e rules index generator
```

---

## Developer Guide

### Rebuilding Metadata Indexes
To update the catalog or mechanics index from a newer 5etools ZIP:
```bash
python3 scripts/build-catalog.py /path/to/5etools.zip
python3 scripts/build-rules.py /path/to/5etools.zip
python3 scripts/build-character-rules.py /path/to/5etools.zip
```

### Packaging for Cloudflare Deployment
```bash
# Package static assets into dist/client and worker into dist/server
node scripts/build.mjs

# Apply D1 migrations locally with Wrangler
npx wrangler d1 migrations apply DB --local --config dist/server/wrangler.json

# Run local multiplayer worker
npx wrangler dev --local --config dist/server/wrangler.json
```

---

## Attribution & Licenses

- Rules mechanics are grounded in the System Reference Document 5.1 / 5.2. See [dist/assets/srd-attribution.txt](dist/assets/srd-attribution.txt).
- Bundles third-party libraries: SheetJS ([license](dist/assets/sheetjs-license.txt)) and JSZip ([license](dist/assets/jszip-license.txt)).
- Typography: DM Sans and Playfair Display under the SIL Open Font License.
