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
- **Class Build Choices**: Indexes class/subclass progressions, optional features, prerequisites, bonus spells, tools, and languages from the local 5etools release. Tracks monk Ki and separate Pact Magic resources. The feature list distinguishes playable controls from rules references whose effects still need automation.

### 2. 5etools Archive & Adventure Library
- **Offline IndexedDB Storage**: Attaches 5etools ZIP releases directly in the browser without re-uploading on refresh.
- **Searchable Catalog**: Filter official adventures and sourcebooks by title, series, and recommended party level (1–20).
- **Map & Chapter Indexes**: Access chapter breakdowns and map lists (identifying DM maps vs. player maps).

### 3. Tactical Virtual Tabletop (VTT)
- **Monster Sizes**: Local 5etools size categories set Large tokens to 2×2 squares, Huge to 3×3, and Gargantuan to 4×4. Existing monster tokens inherit their source size too. Placement, paths, collision, reach, area targeting, hover labels, and action callouts use the creature's space. Run `node scripts/test-token-sizes.mjs` for footprint checks; rebuild the size index with `python3 scripts/build-monster-sizes.py`.
- **Computer Vision Grid Snapping**: Auto-aligns the tactical 5-foot grid to printed battle map artwork using image luminance edge detection.
- **Fog of War & Line of Sight**: Raycasted field-of-view taking into account darkvision, walls, and vision-blocking screens. Explored terrain is saved compactly using binary bitsets.
- **A\* Movement & Opportunity Attacks**: Pathfinding accounts for difficult terrain, prone penalties, and wall barriers. Moving out of enemy melee reach automatically triggers real-time opportunity attacks.
- **Shared Turns**: Consecutive party members in initiative can move, attack, cast, and use class abilities together until the next enemy. Each character keeps an independent action, bonus action, attacks, movement, casting restrictions, and class follow-ups. Each ends their own turn; enemies wait until the entire group finishes. Concurrent commands retry only while the acting character and their budget remain unchanged. Rapid clicks retain the latest destination while a write is in flight. Use **WASD** or **arrow keys** to step the selected character one square at a time; typing in chat or forms stays unaffected. Tokens animate along their recorded paths; movement messages update immediately instead of waiting behind attacks.
- **Sneak Attack & Criticals**: Finesse/ranged attacks automatically add Sneak Attack once per turn when an eligible party member is within 5 ft of the target, or advantage permits it. Net disadvantage blocks it. Weapon and spell attacks critically hit only on the kept natural 20, per this game’s configured rule.
- **Automated Spell Mechanics**: AoE sphere flood-fills, cone projections, and concentration tracking for spells including *Fireball*, *Misty Step*, *Magic Missile*, *Sleep*, *Aid*, *Witch Bolt*, *Fog Cloud*, and *Darkness*.
- **Autonomous Hostile Monster AI**: Enemy creatures stand from prone, approach targets, dash when distant, use Nimble Escape, resolve multiattack routines, and dodge when idle.
- **Character Action Hotbar**: A compact single-row bottom dock keeps the map full-width, with floating party portraits and action details that open only when needed. Scroll or expand to reach extra actions. Weapon, spell, item, and class-ability tiles show costs; filter by action, bonus action, Ki, or spell-slot level and select targets on the map. Flurry follow-ups stay visible after activation. Use **Checks** for skills and resting, **1–0** for visible tiles, and **Escape** to cancel targeting.
- **Action Messages & Dice Effects**: Player and monster actions appear in a taller log at the far left and animated token callouts, with floating damage/healing. Expand the log for the full available combat history, return to compact view, or minimize it to its header. The size preference persists locally; scrolling keeps the visible entry in place as new actions arrive. Beveled d4, d6, d8, d10, d12, and d20 models show the recorded dice pool on a flat table through a true overhead orthographic camera, then reveal the natural result, modifier, and total. A transparent full-screen canvas and viewport-sized physics bounds keep entire dice visible, including on mobile and during resizing. Player dice and attack callouts last longer than monster ones; callouts can be dismissed. Large pools retain every die type in the animation and report the full count. All players see the same committed results. Use **Tools → Dice animations** to switch to a brief static reveal; reduced-motion preferences and browsers without WebGL are also supported.
- **Story Journal**: Automatically reads room polygon entries and surfaces DM read-aloud boxed text as the party explores. Freeing captives like Sildar Hallwinter updates the campaign story journal.

### 4. Adventure Rooms & Multiplayer Campaign Tables
- **Guided Character Builder**: Choose **Character sheets → Create character** for a seven-step builder with local draft saving. It supports single-class levels 1–20, 2014/2024 origins, standard-array/point-buy/manual scores, subclass and feature selections, proficiencies/languages, source starting-equipment packages, spellbooks/preparation, and a completion review. Created sheets work with **Party → Add** in rooms. Rebuild creation data with `python scripts/build-character-builder.py /path/to/5etools-v2.41.2`; validate with `node scripts/test-character-builder.mjs`.
- **Persistent Adventure Rooms**: Open **Rooms → New adventure room**, choose the adventure, map, and starting party, and give the room a name. Each room gets an independent server save and invite link, even when rooms use the same adventure or map. Resume from the room list or its invite. HP, slots, class resources, combat, monsters, terrain, fog memory, and story progress remain in that room. New rooms start fresh; **Use the prepared encounter** explicitly copies the setup state instead.
- **Room Deletion**: Room creators can choose **Delete room** on a room card and confirm its name. Deletion removes that room’s save, chat, membership, and uploaded room images; other rooms remain intact. Deletion requires a private Secure/HttpOnly creator cookie, verified against a hash stored outside shared room state. Public player IDs never authorize deletion. Existing rooms without this credential have deletion disabled; they cannot be claimed through an invite or old creator ID. Clearing the creator cookie loses deletion access. A changed revision blocks a stale confirmation, and connected players return to Rooms when the room disappears.
- **Room Discovery**: Joined rooms are indexed server-side using this browser’s player ID and cached locally for convenience. Opening an invite on another browser adds the room to that browser’s list. Existing shared-session links continue to work and appear in the room list. Apply `drizzle/0004_room_creator_auth.sql` for the private creator hash before deploying the updated deletion handler.
- **Edge Architecture**: Powered by Cloudflare Workers, D1 SQLite database, and R2 image storage.
- **Shared Images**: Map artwork and custom tokens use R2 when a bucket is configured, or chunked D1 storage otherwise. Apply `drizzle/0003_session_images.sql` to enable the database image store. Run `node scripts/test-session-images.mjs` with Node 24+ to verify image sharing without R2.
- **Optimistic Concurrency**: Fast turn state synchronization with conflict reconciliation.
- **Party Seats**: Up to 4 players can claim character seats and control their cameras independently.
- **Party Chat**: Integrated chat with 200-message scrollback, unread badges, and speaker attribution.

---

## Project Layout

Run `node scripts/test-adventure-rooms.mjs` (Node 24+) for independent room saves, discovery, legacy rooms, and metadata preservation; `node scripts/test-shared-turns.mjs` for independent shared actions, spells, Ki, four-character turn endings, saved budgets, and next-round recovery; `node scripts/test-play-feedback.mjs` for Sneak Attack, natural-20 crits, mixed dice, shared movement, path animation, and message priorities; `node scripts/test-action-bar.mjs` for hotbar availability and resource filters, `node scripts/test-action-events.mjs` for committed roll events, `node scripts/test-dice-geometry.mjs` for accurate solids and numbering, and `node scripts/test-class-progression.mjs` for source-based choices, monk actions and reactions, spell grants, prerequisites, and Pact Magic recovery. Dynamic fog is configured per room under **Tools**. **Draw / edit walls** opens free-positioned wall chains, draggable shared vertices, vertex snapping (Alt bypasses), doors, segment splitting/erasing, and undo/redo. Escape, Enter, or right-click finishes a chain; Done returns to play. The wall editor reveals the map locally while tracing. Token vision supports range, cone, and facing; room settings control party/personal vision, exploration memory, opacity, inward soft edges, and movement blocking. Walls and vision settings persist with the room and sync to players. Run `node scripts/test-dynamic-fog.mjs` for geometry, door sight, vision polygons, and personal exploration memory.

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

### Rebuilding the Dice Renderer

The client includes a local bundle of Three.js and cannon-es; it loads on the first dice animation and needs no external CDN. Rebuild it after editing `scripts/dice-renderer/scene.mjs` or `dist/dice-geometry.mjs`:

```bash
npm ci --prefix scripts/dice-renderer
npm run build --prefix scripts/dice-renderer
node scripts/dice-renderer/test-physics.mjs
node scripts/dice-renderer/test-viewport.mjs
node scripts/build.mjs
```

The physics check covers every result on all six standard dice, mixed pools, and advantage. The viewport check projects every hull vertex in every animation frame across desktop, phone, landscape, ultrawide, and resized displays; it also checks centered, equilateral d20 result faces and upright reading axes. Rendering only presents committed game results; it never rerolls them. Library licenses are included in `dist/assets/dice-libraries.txt`.

---

## Attribution & Licenses

- Rules mechanics are grounded in the System Reference Document 5.1 / 5.2. See [dist/assets/srd-attribution.txt](dist/assets/srd-attribution.txt).
- Bundles third-party libraries: SheetJS ([license](dist/assets/sheetjs-license.txt)) and JSZip ([license](dist/assets/jszip-license.txt)).
- Built-in illustrations come from the original 5etools publication references, with no generated artwork. [Artwork sources](dist/assets/artwork-sources.json) records each local data reference, image path, and SHA-256. The build rejects unlisted or modified raster artwork. The supplied release omits image binaries, so the matching source images are fetched once and bundled unchanged.
- Typography: DM Sans and Playfair Display under the SIL Open Font License.

Activity can appear as system messages in the party chat timeline using **Include activity log**, or as a separate panel through **Tools → Activity log**. Expanding the separate panel does not reposition party portraits. The chat timeline reuses visibility-filtered, roll-paced activity entries and preserves the reader’s scroll position.

### World interactions and movement rendering

The play screen renders map scenery and moving tokens on separate canvases. Animation frames reuse the prepared scene instead of recomputing visibility, artwork and UI; validated movement starts before the multiplayer save completes, and stale saves still roll back through revision checks. Shared-room polling speeds up during combat and recent activity.

`Interact` groups corpse loot, carrying, placement and throwing in one contextual menu. Potions and throwable weapons expose use choices beneath one item icon. Loot and currency persist in the room actor and its shared character sheet. Only explicit source equipment, tagged treasure, listed coins and recognized valuables become pickups; missing monster loot is not invented. Existing rooms gain supported treasure metadata without resetting encounters. Monster equipment/CR metadata comes from the local 5etools bestiary; regenerate with `python scripts/build-monster-rewards.py`.

Defeated hostiles award their CR XP once to initiative participants, splitting integer remainders deterministically. The finisher receives an additional 20% of their own share, rounded down. Bodies remain on the map. Carrying uses Strength/size capacity and halves speed; unspecified body weights use size estimates. Pickup and throwing cost an action in combat; placement within 5 feet is free. Throws reach 20 feet and deal 1d4 impact damage to the body; targeting a creature uses an improvised Strength attack, with a free adjacent landing space required. Healing a carried creature releases them when an adjacent space is available.

Focused rules verification: `node scripts/test-world-interactions.mjs`.

### Room-wide campaign saves

Each shared room owns one canonical `state.battle` ledger across its adventure. Party HP, resources, inventory, XP, initiative, actor identities, loot and story belong to that room. NPCs carry a `sceneKey` for their current physical map; rules/rendering use a filtered active-scene view, and saves merge it back into the one room ledger. Scene records store only map metadata, arrival coordinates and physical environment (walls, terrain, exploration, treasure markers and zones), never independent parties or battles.

Tools → Adventure map changes the map for every connected player between encounters. Visited-map metadata is retained in the room so guests can revisit without attaching the archive. The journal retains discoveries across maps, including identically numbered areas. Existing room saves normalize on resume; a migrated room rejects older clients attempting to drop campaign fields. Dashboard previews use one `wayfarer-preview-room-v2` save; old map-keyed browser entries remain untouched as migration backups.

Checks: `node scripts/test-room-campaign.mjs` and `node scripts/test-room-campaign-session.mjs`.

### Dashboard spell rules

Workspace → Spell rules opens the dashboard-only editor. It reads spell descriptions from the bundled 5etools index and supports source selection, effect blocks, damage and healing components/upcasting, optional spellcasting ability modifiers, cantrip scaling at levels 5/11/17, saves, conditions, targeting shapes, persistent areas, turn/entry triggers, concentration, difficult terrain, and movable spheres. Reviewed PHB starter configurations cover Wall of Fire, Ice Storm and Flaming Sphere; other spells begin with an empty effect list so unimplemented effects are not invented. Drafts and reusable definitions persist locally and can be imported/exported as JSON. Preview casts use the actual rules engine with sample actors and configurable caster level, slot level and spellcasting modifier. Healing can optionally exclude undead and constructs, caps at maximum HP and revives unconscious creatures without resurrecting the dead.

New rooms snapshot the saved rule library. The dashboard can publish a saved library to a known room between encounters, using revision checks. Existing areas retain their original definition until they expire. Editing is not exposed in the play interface; play exposes only normal targeting and ongoing spell controls. The schema is shared by browser validation and room saves. Unlisted interactions, heights and vertical movement still require manual adjudication.

Verification: `node scripts/test-spell-rules.mjs` plus room, fog, shared-turn and ownership regression checks.

### AI wall forecasting

Tools → AI Forecast scans the current artwork with Gemini 3.8 Flash or 3.6 Flash. Temporary service errors use exponential backoff with jitter, honor short provider cooldowns, and stop after four attempts per scan section. The dialog allows an optional final attempt on the other Flash model. Invalid credentials, exhausted quotas and long cooldowns stop without repeated requests. Retry progress and cancellation are available in the fog tools. Detailed scans use up to six overlapping crops (with the request count shown before starting); quick mode uses one overview. Results are drafts in a zoomable map preview, with weak image support highlighted and small image-based alignment corrections. Applying records wall-editor Undo history. Failed/cancelled scans preserve existing geometry; results are rejected if the room, map or wall data changed during scanning or review. Overlap cleanup merges duplicate lines, preserves separate door leaves, carves every doorway and exposes shared junction vertices without forcing the movement grid. Keys travel in headers, stay out of request URLs, and are only saved in browser storage when requested. A same-origin relay handles blocked direct browser connections without storing the key.

### Search suggestions

Search fields show ranked local matches with source labels, including adventure/sourcebook catalogues, character inventory and spell lists, spell-rule selection, builder choices, class-feature filters, and monster lookup. Arrow keys select a suggestion, Enter applies it, Escape dismisses it, and Tab leaves the field without choosing. Add/edit spell, equipment, weapon, class, species and background fields also offer source data; choosing a spell fills its level/description and preserves its source, equipment fills weight, and weapons fill base damage dice/type. Custom text remains available. The monster name/source index is generated with `python scripts/build-monster-search.py` from the local 5etools bestiary and fetched only when monster lookup is used.

### Play-interface behavior

Wall and doorway tracing overlays appear only while editing fog geometry; saved geometry continues to block vision and movement during normal play. Characters can be added from Party or Multiplayer during combat, spawn near the participating party when a free visible space is available, roll initiative and join the encounter reward participants without resetting the active turn. Each square still costs the same diagonally or orthogonally; equal-cost routes prefer cardinal steps and fewer bends. In-game character sheets and their edit forms dismiss when a click starts and finishes outside the dialog, while chat/activity panels remain open.
