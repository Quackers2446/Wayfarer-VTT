# Wayfarer · 5e Campaign Desk & Virtual Tabletop

[![Live](https://img.shields.io/badge/Live-wayfarer--vtt.pages.dev-blue.svg)](https://wayfarer-vtt.pages.dev/)
[![Architecture](https://img.shields.io/badge/Architecture-Client--first%20vanilla%20ESM-e8cc8b.svg)](#)
[![Multiplayer](https://img.shields.io/badge/Multiplayer-Cloudflare%20Pages%20%2B%20D1%20%2B%20R2-orange.svg)](#)

**Wayfarer** is a browser-based D&D 5e campaign desk and virtual tabletop for **one to four players without a DM**. Import or build characters, pick a published adventure, open a shareable room, and play on a map-first board with fog, combat automation, spells, story read-alouds, chat, and optional spatial voice.

- **Production:** [https://wayfarer-vtt.pages.dev/](https://wayfarer-vtt.pages.dev/)
- **Spell rules authoring:** [SPELL_ENGINE.md](SPELL_ENGINE.md)
- **Deeper architecture notes:** [WAYFARER_EXPLAINED.md](WAYFARER_EXPLAINED.md) (may lag; trust the code for exact behavior)

Editable web source lives under `dist/`. `node scripts/build.mjs` packages deployable assets into `dist/client/` (and a Worker bundle). Local galleries (`spell-fx-gallery.html`, `attack-fx-gallery.html`) are served from `dist/` only and are **not** published.

---

## Quick start (local)

```bash
cd wayfarer
python3 scripts/serve.py
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

- **Character sheets → Import supplied sheets** loads sample workbooks from the sibling `Character Sheets/` folder when present.
- **Play / Rooms → Use supplied archive** attaches a sibling `5etools-v*.zip` (or tree) for maps, monsters, and adventure data.
- Local FX galleries: `/spell-fx-gallery.html`, `/attack-fx-gallery.html` (cache-bust query on clip URLs; not shipped in Pages builds).

Node **24+** is expected for the `scripts/test-*.mjs` suite.

---

## What it does today

### Campaign desk
- Spreadsheet / Google Sheets character import, sheet editor, guided **Create character** builder (single-class 1–20).
- Adventure library from a local 5etools archive (IndexedDB).
- Dashboard **Spell rules** editor, Foundry JSON import (selective), private animated test board, publish overrides into a room between encounters.
- Optional **Google sign-in** for synced characters, tokens, spell rules, profile, and linked rooms (guests still work).

### Adventure rooms
- Named persistent rooms with invite links; one **room-wide battle ledger** across maps (HP, slots, inventory, XP, story, combat).
- Map metadata (walls, fog memory, terrain, zones, arrivals) per scene; Tools → Adventure map switches maps for everyone between encounters.
- Creator-only room deletion (Secure cookie + server hash); chat, membership, and images cleaned up with the room.

### Play (map-first VTT)
- Grid play with fog / walls / doors, A\* movement, opportunity attacks, shared party turns, enemy AI, rests, loot / bodies / interact.
- Hotbar for weapons, spells, features, items; committed dice + action cues for all clients.
- **Story:** entering a new area shows a short-lived read-aloud toast; the Story tab is the journal of what was already found.
- **Chat:** ephemeral message chips when the panel is closed (voice-chip style, right side); full history in the chat panel.
- **Mobile (≤820px):** board-first compact UI — tap character → actions sheet → picking an action collapses the sheet and shows an aim banner; Menu collapses chrome. One finger pans the map; pinch zooms.
- Spell / attack WebM FX (JB2A + keyed BLFX clips); local galleries must stay in sync when clips change (see personal Cursor rule for gallery updates).

---

## Layout

```
wayfarer/
├── dist/                 # Editable web app (source of truth for the client)
│   ├── index.html
│   ├── app.mjs           # Dashboard router
│   ├── play.mjs          # In-room / game controller
│   ├── game-screen.mjs   # Play HUD markup
│   ├── combat.mjs        # Rules, rolls, pathfinding
│   ├── spell-library/    # Built-in spell rule batches
│   ├── assets/           # Fonts, artwork metadata, animations credits
│   └── …                 # CSS + modular ESM
├── worker/               # Cloudflare Pages / session Worker sources
├── drizzle/              # D1 migrations (0000–0008+)
├── scripts/              # serve.py, build.mjs, indexes, test-*.mjs
└── wrangler.json         # Pages project config (output: dist/client)
```

Sibling fixtures (not in this repo): `5etools` / `5etools-v*.zip`, `Character Sheets/`, optional `foundry-reference/`.

---

## Develop & test

```bash
# Metadata from a newer 5etools ZIP
python3 scripts/build-catalog.py /path/to/5etools.zip
python3 scripts/build-rules.py /path/to/5etools.zip
python3 scripts/build-character-rules.py /path/to/5etools.zip

# Focused checks (examples)
node scripts/test-spell-engine.mjs
node scripts/test-action-events.mjs
node scripts/test-room-campaign.mjs
node scripts/test-dynamic-fog.mjs
node scripts/test-shared-turns.mjs
```

There are many `scripts/test-*.mjs` files; run the ones that touch the area you changed. After packaging, prefer importing **`dist/client/...`** once before a production push so the build copy is verified.

### Dice renderer rebuild

```bash
npm ci --prefix scripts/dice-renderer
npm run build --prefix scripts/dice-renderer
node scripts/dice-renderer/test-physics.mjs
node scripts/dice-renderer/test-viewport.mjs
node scripts/build.mjs
```

---

## Deploy (Cloudflare Pages)

```bash
node scripts/build.mjs
npx wrangler pages deploy dist/client --project-name wayfarer-vtt --branch main --commit-dirty=true
```

- Project: `wayfarer-vtt` · output dir: `dist/client`
- Apply new `drizzle/*.sql` migrations to the bound D1 database when a release needs them.
- Set `GOOGLE_CLIENT_ID` in Pages for Google sign-in; add `https://wayfarer-vtt.pages.dev` as an authorized JavaScript origin.
- Local Worker (optional):  
  `npx wrangler d1 migrations apply DB --local --config dist/server/wrangler.json`  
  `npx wrangler dev --local --config dist/server/wrangler.json`

Animation binaries under `**/assets/animations/**` are gitignored (credits.json stays tracked). `vendor/` pack downloads are also ignored.

---

## Typography & art

- UI fonts: **Spectral** (display) and **Alegreya Sans** (body).
- No AI-generated product art. Bundled rasters are provenance-checked via `dist/assets/artwork-sources.json`.
- Animation attribution: `dist/assets/animations/credits.json`.

---

## Attribution

- Rules grounded in SRD 5.1 / 5.2 — see `dist/assets/srd-attribution.txt`.
- SheetJS and JSZip licenses under `dist/assets/`.
- Spell/attack video clips follow their recorded licenses (JB2A / BLFX / credits.json).
