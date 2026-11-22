# Wayfarer: Complete System & Architecture Guide

Wayfarer is a standalone, client-first 5th Edition Dungeons & Dragons (5e) virtual tabletop (VTT) and campaign management application. It runs directly in modern web browsers without requiring external servers for solo play, and includes an optional Cloudflare Worker backend for real-time multiplayer campaigns.

---

## Table of Contents
1. [High-Level Overview](#1-high-level-overview)
2. [Project Structure & Tech Stack](#2-project-structure--tech-stack)
3. [Application Navigation & Pages](#3-application-navigation--pages)
4. [Character Import & Sheet Engine](#4-character-import--sheet-engine)
5. [5e Rules Engine & Class Mechanics](#5-5e-rules-engine--class-mechanics)
6. [5etools Archive & Adventure Catalog](#6-5etools-archive--adventure-catalog)
7. [Tactical Grid & Computer Vision Alignment](#7-tactical-grid--computer-vision-alignment)
8. [Fog of War, Vision & Wall Blocking](#8-fog-of-war-vision--wall-blocking)
9. [Turn-Based Combat & Action Economy](#9-turn-based-combat--action-economy)
10. [Autonomous Monster AI](#10-autonomous-monster-ai)
11. [Story Journal & Scripted Room Triggers](#11-story-journal--scripted-room-triggers)
12. [Multiplayer & Cloudflare Edge Backend](#12-multiplayer--cloudflare-edge-backend)
13. [Build System & Tooling](#13-build-system--tooling)

---

## 1. High-Level Overview

Wayfarer addresses three main needs for tabletop RPG groups:
- **Campaign Desk**: Ingests Excel (`.xlsx`) or Google Sheets exports, deriving official 5e mechanics (attributes, proficiency, AC, skills, spell slots, class features) while letting players edit values and track resources.
- **Adventure Organizer**: Indexes published 5e adventure modules, sourcebooks, chapters, and map references from 5etools release archives.
- **Tactical Virtual Tabletop (VTT)**: Renders battle maps with high-performance 2D Canvas graphics, real-time line-of-sight fog of war, A* pathfinding, opportunity attacks, automated spells, autonomous enemy AI, and synced multiplayer tables.

All player data (characters, active adventure, explored fog, map tokens, combat states) is saved locally in browser `localStorage` and `IndexedDB`.

---

## 2. Project Structure & Tech Stack

```
wayfarer/
├── dist/                          # Web application source files
│   ├── index.html                 # Main single-page application entry
│   ├── styles.css                 # Base dashboard layout & typography
│   ├── character-view.css         # Character sheet & editing styles
│   ├── play.css                   # Map setup & encounter desk styles
│   ├── game.css                   # In-game tactical VTT HUD styles
│   ├── app.mjs                    # SPA routing, state store, dialogs
│   ├── characters.mjs             # Spreadsheet parser (.xlsx via SheetJS)
│   ├── character-rules.mjs        # 5e mechanics derivation engine
│   ├── character-view.mjs         # Character sheet UI renderer
│   ├── sheet-editor.mjs           # Character sheet editing & validation
│   ├── class-features.mjs         # 5e class progressions, feats, choices
│   ├── class-actions.mjs          # In-combat class abilities & rest recovery
│   ├── class-feature-view.mjs     # Class feature editor & rules view
│   ├── rules-library.mjs          # 5etools archive loader & spell index
│   ├── play.mjs                   # Tactical map controller & game lifecycle
│   ├── game-screen.mjs            # In-game HUD, party sidebar, stage
│   ├── grid-view.mjs              # 2D Canvas renderer (tokens, fog, grid)
│   ├── map-grid.mjs               # Grid math & optical ridge alignment
│   ├── map-walls.mjs              # Raycasting, wall blockers & floor polys
│   ├── map-camera.mjs             # Pan, zoom & viewport management
│   ├── fog-memory.mjs             # Compact bitset fog-of-war persistence
│   ├── combat.mjs                 # 5e combat engine, rolls, spells, conditions
│   ├── combat-cues.mjs            # Floating combat roll animations & text
│   ├── enemy-turn.mjs             # Hostile creature automated decision tree
│   ├── encounters.mjs             # Map room parsing, rosters, monster stats
│   ├── scene-populate.mjs         # Room monster & marker spawners
│   ├── scene-data.mjs             # Room marker metadata extraction
│   ├── adventure-story.mjs        # Story journal & read-aloud triggers
│   ├── multiplayer.mjs            # Client-side session synchronization
│   ├── game-chat.mjs              # In-game party chat widget
│   ├── monster-art.mjs            # Monster portrait caching & rendering
│   ├── character-token.mjs        # Custom character portrait processing
│   ├── format.mjs                 # Text escaping & string utilities
│   ├── icons.mjs                  # SVG icon library
│   ├── catalog.json               # Pre-indexed adventure & sourcebook index
│   ├── rules.json                 # Pre-indexed spells & base weapons
│   ├── character-rules.json       # Pre-indexed species, classes, feats
│   └── assets/                    # Images, fonts, SheetJS, JSZip
├── worker/
│   └── session.mjs                # Cloudflare Worker API (/api/sessions)
├── drizzle/                       # Database schema migrations for D1 SQLite
│   ├── 0000_shared_tables.sql     # game_sessions table
│   ├── 0001_session_chat.sql      # session_chat table
│   └── 0002_session_players.sql   # session_players table
└── scripts/
    ├── serve.py                   # Local HTTP dev server with file access
    ├── build.mjs                  # Copies dist to dist/client & dist/server
    ├── build-catalog.py           # Compiles catalog.json from 5etools ZIP
    ├── build-rules.py             # Compiles rules.json from 5etools ZIP
    └── build-character-rules.py   # Compiles character-rules.json
```

### Technology Highlights
- **Vanilla ES Modules (`.mjs`)**: No heavy frameworks (React, Vue) or bundling steps required during active development.
- **HTML5 Canvas 2D**: Hardware-accelerated rendering for maps, tactical grids, dynamic lighting/fog, and token tokens.
- **SheetJS (`xlsx.full.min.js`)**: In-browser binary spreadsheet decoding.
- **JSZip (`jszip.min.js`)**: In-browser ZIP archive extraction for 5etools data files and map images.
- **IndexedDB**: Persistent client-side caching of large 5etools archive ZIPs (`wayfarer-data-v1`).
- **Cloudflare D1 & R2**: Edge SQL database and object storage for multi-user session state and custom artwork.

---

## 3. Application Navigation & Pages

Wayfarer manages view state through browser URL hashes (`location.hash`):

| Hash Route | View Description |
|---|---|
| `#overview` | Home dashboard: Hero banner, active party summary, current adventure card, featured adventures. |
| `#characters` | Character roster: Party cards with HP meters, AC, Level, token portraits, and workbook import modal. |
| `#characters/:id` | Individual character sheet: Vitals, attributes, actions, skills, inventory, spells, rules, and edit form. |
| `#characters/:id/:section` | Direct section link: `overview`, `actions`, `skills`, `inventory`, `spells`, `rules`, or `edit`. |
| `#library` | 5etools adventure & book catalog: Search, level filters, chapter breakdowns, and map indexes. |
| `#play` | Tactical map setup: Map selector, grid alignment, token placement, archive attachment, and session launch. |
| `#game` | Fullscreen tactical VTT: 2D battle map, initiative tracker, action HUD, combat cues, story, and chat. |
| `#game/:sessionId` | Multiplayer game session: Automatically connects to the shared Cloudflare Worker session. |

---

## 4. Character Import & Sheet Engine

### Supported Formats (`characters.mjs`)
1. **Template Sheets (v1.3 & v1.4 / MPMB style)**:
   - Recognizes complex multi-page layouts with explicit cells (`T6` CLASS, `C12` STR, `AL5`/`AM5` LEVEL).
   - Reads combat vitals, attribute modifiers, attacks, inventory, spells across levels, and spell slot matrices.
   - Automatically checks an `Additional` tab for overflow spells and auxiliary attacks.
2. **Simple Spreadsheet Formats**:
   - Parses arbitrary sheets using two-column `Key: Value` layouts or header rows with values underneath.
   - Recognizes standardized labels for Character Name, Class, Species, Level, AC, HP, Speed, and Ability Scores.
3. **Google Sheets Integration**:
   - Accepts public viewable Google Sheets links and converts them directly to Google's `.xlsx` export URL:
     `https://docs.google.com/spreadsheets/d/{id}/export?format=xlsx`.

### Custom Sheet Editor (`sheet-editor.mjs`)
Allows modifying or supplying missing sheet data:
- Overrides base scores, levels, species, and background.
- Selects worn armor category (Padded, Leather, Studded Leather, Hide, Chain Shirt, Scale Mail, Breastplate, Half Plate, Ring Mail, Chain Mail, Splint, Plate) and shield to auto-calculate AC.
- Toggles between fixed class HP advancement and rolled HP.
- Configures skill training ranks (Untrained, Proficient, Expertise).
- Adjusts current and maximum spell slots (ranks 1–9).

---

## 5. 5e Rules Engine & Class Mechanics

The rules engine (`character-rules.mjs`, `class-features.mjs`, `class-actions.mjs`) enriches raw imported sheets with SRD mechanics:

### Automated Mathematical Derivations
- **Proficiency Bonus**: $\text{PB} = 2 + \lfloor\frac{\text{Level} - 1}{4}\rfloor$.
- **Ability Modifiers**: $\lfloor\frac{\text{Score} - 10}{2}\rfloor$.
- **Armor Class Formulas**:
  - Unarmored: $10 + \text{Dex mod}$.
  - Monk Unarmored Defense: $10 + \text{Dex mod} + \text{Wis mod}$ (when not wearing armor or shield).
  - Light Armor: $\text{Base} + \text{Dex mod}$.
  - Medium Armor: $\text{Base} + \min(2, \text{Dex mod})$.
  - Heavy Armor: $\text{Base}$ (no Dex mod).
  - Shield: $+2$ AC.
- **Spellcasting Vitals**:
  - Spell Save DC: $8 + \text{PB} + \text{Casting Mod}$.
  - Spell Attack Bonus: $\text{PB} + \text{Casting Mod}$.
- **Multiclass Spell Progression**: Accurately computes combined caster levels for multiclass characters across full casters, half casters ($\lceil L/2\rceil$ for 2024 / Artificer, $\lfloor L/2\rfloor$ for 2014), third casters ($\lfloor L/3\rfloor$), and Pact Magic pools.

### Class Mechanics Support
- **Barbarian**: Rage resource pool, bonus damage, and damage resistances.
- **Bard**: Bardic Inspiration die progression (d6 $\to$ d8 $\to$ d10 $\to$ d12), short-rest recovery via *Font of Inspiration*, reaction *Cutting Words* to reduce enemy rolls.
- **Fighter**: *Second Wind* (heals $1\text{d}10 + \text{Fighter Level}$ as a bonus action), *Action Surge* (grants extra action), *Extra Attack* scaling up to 4 attacks.
- **Monk**: *Martial Arts* bonus unarmed strike, *Flurry of Blows* (2 unarmed strikes for 1 Ki), *Patient Defense* (Dodge as bonus action), *Step of the Wind* (Dash/Disengage as bonus action), *Stunning Strike* (forces CON save vs Ki DC), *Deflect Missiles* reaction, and *Arms of the Astral Self*.
- **Rogue**: *Sneak Attack* (scales by level; triggers on advantage or adjacent ally with finesse/ranged weapon), *Cunning Action* (Dash, Disengage, or Hide as bonus action), *Uncanny Dodge* (halves damage from visible attack as reaction), *Reliable Talent* (minimum 10 on proficient d20 checks).
- **Wizard**: *Bladesong* resource pool (+10ft speed, AC bonus equal to INT mod, advantage on Acrobatics, concentration CON save bonus).

---

## 6. 5etools Archive & Adventure Catalog

Wayfarer can directly read 5etools release archives (`5etools-v*.zip`):
- **Local Storage via IndexedDB (`rules-library.mjs`)**: The archive ZIP file is saved locally under the `wayfarer-data-v1` database so users do not need to re-upload it on page reloads.
- **Direct Zip Decompression**: Uses `JSZip` to extract adventure metadata (`data/adventures.json`), chapter text, room maps, bestiary stat blocks, and spell rules on demand.
- **Map Image Resolution**: Loads high-res map artwork directly from the attached ZIP (`img/` folder) or falls back to public 5etools CDN mirrors (`https://cdn.5e.tools/2024/img/`).

---

## 7. Tactical Grid & Computer Vision Alignment

### The Alignment Challenge
Published battle maps often have slightly irregular printed grids, scanning distortions, or varying pixel resolutions per 5-foot square.

### Optical Alignment Algorithm (`map-grid.mjs`)
Wayfarer uses computer vision to automatically snap its tactical grid to printed artwork:
1. Draws the map onto an offscreen canvas.
2. Extracts image pixel data and computes grayscale luminance values:
   $$\text{Luma} = \frac{3R + 6G + B}{10}$$
3. Calculates horizontal and vertical ridge profiles using edge filters:
   $$\text{Ridge} = \max(0, |B_1 + B_2 - 2C| \times 0.5 - |B_1 - B_2| \times 0.57 - 1)$$
4. Scores repeating peak intervals against the source grid spacing with `fitAxis` and automatically locks the 5-foot tactical cells to the printed artwork lines.

---

## 8. Fog of War, Vision & Wall Blocking

### Line of Sight Raycasting (`map-walls.mjs`)
- Performs Bresenham-style raycasting between cell centers.
- Checks against blocking wall polygons and screen edges (e.g. concealed briars or cave rock pillars).
- Calibrated floor definitions for sample adventures (e.g. *Cragmaw Hideout* in LMoP).

### Fog Memory (`fog-memory.mjs`)
- Explored cells are stored as a binary bitset:
  $$\text{Byte Index} = \frac{Y \times \text{Cols} + X}{8}, \quad \text{Bit Mask} = 1 \ll (\text{Index} \bmod 8)$$
- Encoded as Base64 in battle state (`fogMemory: {cols, rows, data}`), minimizing memory and network payload.
- Rendered via an offscreen canvas texture that softly blends between active visible squares, explored territory, and unexplored darkness (`#101a19`).

---

## 9. Turn-Based Combat & Action Economy

### Initiative & Group Movement (`combat.mjs`)
- Rolls $\text{d}20 + \text{Initiative}$ for all tokens on the map.
- **Tied-Initiative Grouping**: Consecutive party members who share the same initiative total can move together during their shared turn window.
- Tracks movement budgets: normal speed + Dash bonus $-$ spent feet.

### 5e Action Economy Rules
- Enforces 1 Action, 1 Bonus Action, and 1 Reaction per round.
- **Bonus-Action Spell Casting Rule**: Casting a bonus action spell (*Misty Step*, *Healing Word*) restricts action spells on that turn to cantrips.
- **Concentration Tracking**:
  - Taking damage triggers a Constitution save against $\text{DC} = \max(10, \lfloor\frac{\text{Damage}}{2}\rfloor)$.
  - Dropping concentration automatically dispels active AoE zones (*Fog Cloud*, *Darkness*) and status conditions (*Hold Person*, *Invisibility*).
- **Opportunity Attacks**: If a creature exits an enemy's melee reach without disengaging, movement pauses and triggers a reaction prompt for the player or AI.

### Automated Spells & AoEs
- **Sphere/Cylinder**: Flood-fills cells within radius (`areaCells`).
- **Cone Calculation (`spellCells`)**: Uses vector projection from the caster to target cell:
  $$\text{Forward} = \frac{u \cdot dx + v \cdot dy}{\text{Length}}, \quad \text{Side} = \frac{|u \cdot dy - v \cdot dx|}{\text{Length}}$$
  Cells qualify if $\text{Forward} \le \text{Cone Distance}$ and $\text{Side} \le \frac{\text{Forward}}{2}$.
- Built-in resolution for *Fireball*, *Burning Hands*, *Magic Missile*, *Misty Step*, *Aid*, *Sleep*, *Hold Person*, *Charm Person*, *Witch Bolt*, *Fog Cloud*, *Darkness*, and *Dragon’s Breath*.

---

## 10. Autonomous Monster AI

Hostile creatures act on their turns automatically via `enemy-turn.mjs`:
1. **Stand from Prone**: If prone, stands up by spending half movement speed.
2. **Target Selection**: Finds conscious party members sorted by distance and accessibility.
3. **Approach & Pathfinding**: Uses A* pathfinding (`approachPath`) to navigate around walls and allies toward target weapon range. Dashes if target is out of normal movement range.
4. **Nimble Escape**: Goblins automatically use a bonus action to Disengage after moving away from melee threats.
5. **Multiattack Execution**: Follows monster stat-block routines (e.g. 1 bite + 1 claw, or 2 scimitar attacks).
6. **Defensive Fallback**: Takes the Dodge action if no targets can be reached or attacked.
7. **Opportunity Attacks**: Resolves hostile reaction attacks automatically when party members flee reach.

---

## 11. Story Journal & Scripted Room Triggers

### Story Journal (`adventure-story.mjs`)
- Tracks room entries using region polygon containment tests (`pointInPolygon`).
- When a party member enters a new area, the app retrieves the official DM read-aloud boxed text (`insetReadaloud`) from the 5etools module data and records it in the **Story Journal**.

### Scripted Encounter Logic
- In *Cragmaw Hideout*:
  - Sildar Hallwinter starts bound and neutral in room `02f`.
  - Wolves start chained in the kennel (`021`) and can be toggled hostile via room controls.
  - Defeating the goblin boss Yeemik and moving adjacent to Sildar triggers the **Free Sildar** action, updating the story log with exposition about Gundren Rockseeker and Cragmaw Castle.

---

## 12. Multiplayer & Cloudflare Edge Backend

Wayfarer supports real-time multi-user tables via `worker/session.mjs`:

### Cloudflare Worker Architecture
- **D1 SQLite Database**:
  - `game_sessions`: Stores map metadata, serialized battle state, revision counter, and artwork content type.
  - `session_players`: Tracks joined player controllers, usernames, join timestamps, and `last_seen` heartbeats.
  - `session_chat`: Stores up to 200 ordered messages per session.
- **R2 Object Storage**: Stores custom map images (up to 16 MB) and SHA-256 hashed character token images.

### Concurrency & Synchronization (`multiplayer.mjs`)
- **Optimistic Concurrency**: Client state updates send `PUT /api/sessions/:id` with `{revision, state}`. Updates succeed only `WHERE id=? AND revision=?`. If another player acted first, returns HTTP 409 and client reconciles state.
- **Seat Claiming**: Up to 4 players can each claim a party character. Unclaimed tokens can be controlled by anyone at the table.
- **Live In-Game Chat (`game-chat.mjs`)**: Auto-labels messages with the sender's claimed character name, tracks unread counts, and maintains scroll position.

---

## 13. Build System & Tooling

Wayfarer requires no complex npm build step for client code. It uses lightweight scripts in `scripts/`:

### Development Server (`scripts/serve.py`)
```bash
python3 scripts/serve.py --port 5173
```
- Serves the `dist/` directory on `http://127.0.0.1:5173/`.
- Provides opt-in local endpoints:
  - `/local-sheets`: Lists and serves `.xlsx` files from the adjacent `Character Sheets/` folder.
  - `/local-archive`: Streams the adjacent `5etools*.zip` directly to the client.

### Catalog Compiler (`scripts/build-catalog.py`)
```bash
python3 scripts/build-catalog.py /path/to/5etools.zip
```
Extracts adventure titles, sourcebooks, chapters, and map references into `dist/catalog.json`.

### Rules Compilers (`scripts/build-rules.py` & `scripts/build-character-rules.py`)
```bash
python3 scripts/build-rules.py /path/to/5etools.zip
python3 scripts/build-character-rules.py /path/to/5etools.zip
```
Compiles SRD spells, weapons, species, backgrounds, class tables, and subclass features into `dist/rules.json` and `dist/character-rules.json`.

### Worker Distribution Packaging (`scripts/build.mjs`)
```bash
node scripts/build.mjs
```
Copies `dist/` web assets into `dist/client/` and `worker/session.mjs` into `dist/server/index.js` for deployment with Cloudflare Wrangler.
