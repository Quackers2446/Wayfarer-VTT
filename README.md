# Wayfarer

Wayfarer is a 5e campaign setup dashboard for importing character workbooks and selecting an adventure. The browser saves your party and active adventure on the device and origin where you imported them.

## Run locally

From the `wayfarer` folder, run `python3 scripts/serve.py` and open <http://127.0.0.1:5173/>. On the Character sheets page, **Import supplied sheets** uses the workbooks in the adjacent `Character Sheets` folder. That folder is outside the deployment directory. You can also serve `dist` with any static HTTP server and upload workbooks manually.

## Import a character

Use **Import character** to select or drop one or more `.xlsx` files, including Excel exports from Google Sheets. The importer supports the supplied v1.3 and v1.4 layouts and simple sheets with labels such as Character Name, Class, Species, Level, Armor Class, Hit Points, and Strength. Simple sheets can use a two-column label/value layout or a header row with the values directly beneath it. The importer reads spreadsheet values saved by Excel or Google Sheets. Re-export a workbook with missing calculated results to restore its formula values.

Open a character's sheet and use **Upload token** to choose a PNG, JPEG, or WebP image for its portrait and map token. Wayfarer crops the center to a square and preserves transparency. The same controls are available by opening a party portrait during play. Shared games sync token changes to the rest of the table.

The **Rules** tab shows where the character's missing values were filled in. Existing workbook values take priority. Wayfarer can derive proficiency, walking speed, certain skills and saves, Hit Dice, and spell-slot capacities. It also shows known features and fixed benefits from the character's class, species, and background. Change **Rules edition** in that tab if the automatic match picks the wrong edition. Unrecorded rolls, equipment, chosen options, and remaining spell slots still come from the sheet or the table.

Use **Edit sheet** to enter missing values and record choices such as worn armor, fixed HP advancement, skill training, and remaining spell slots. Blank fields fall back to the workbook or the rules. Saved edits carry into new tokens and survive re-importing the workbook. For a token already placed on a solo map, select it outside combat and choose **Update token from sheet**. The existing token retains its current HP and remaining slots up to the updated maximums.

You can also paste a Google Sheets link with viewer access for anyone with the link. For a restricted workbook, export it using **File → Download → Microsoft Excel (.xlsx)** and upload the file. The Google Sheets link points directly to Google's export endpoint.

## Refresh the catalog

Run `python3 scripts/build-catalog.py /path/to/5etools.zip` from this folder. The committed index contains bibliographic data, chapter titles, and map references from the supplied 5etools v2.41.2 ZIP. Map images live in the separate 5etools image pack. The dashboard art is original, generated for Wayfarer.

Run `python3 scripts/build-character-rules.py /path/to/5etools.zip` to refresh the character mechanics index.

## Artwork

The built-in ImageGen tool created the four original dashboard scenes in `dist/assets`. These are the prompts used for the selected JPEGs.

- **hero.jpg** — Create an original panoramic 3:1 medieval fantasy landscape background for a dark forest-green campaign organizer web dashboard. Painterly realistic classical oil landscape with fine brushwork, editorial and tasteful, Old World verdigris shadows, warm muted gold clouds. Left half dark shaded pine ridge, dim tree silhouettes and near-black evergreen atmosphere so overlaid cream UI text reads. Right half shows a winding pale river leading to a small ruined stone hilltop citadel, rocky alpine spires, low warm atmospheric sun on the skyline, textured pine forests. Frame it from a valley overlook, wide screen, horizon at upper middle. Moody, atmospheric and calm, gold and evergreen toned. No lettering, UI, icon, border, people, or any reference to an existing game.
- **forest.jpg** — Original high-end medieval fantasy environment key art, horizontal wide 3:2. An ancient half buried stone arch in a mossy ravine and dense pine forest, a warm late afternoon ray piercing the green shadow. Fern and rocky foreground with a distant footpath. Classical realistic oil painting, warm weathered greens, grounded, strong clean readable composition at thumbnail size, softly textured brushwork. No text, frames, interface, people, existing game artwork.
- **castle.jpg** — Original realistic classical oil painting landscape for a tabletop medieval fantasy campaign card, horizontal wide 3:2. One pointed gothic stone castle on a remote rocky pinnacle in an expansive misty valley, distant bats as tiny silhouettes, mauve sky and glowing blood-orange autumn clouds, faded crimson autumn trees. Clean readable composition at thumbnail size. Twilight, weathered textures, moody. No text, frames, interface, existing game artwork.
- **jungle.jpg** — Original realistic classical oil painting landscape for a tabletop fantasy campaign card, horizontal wide 3:2. Enormous ancient sandstone temple gates and monumental weathered pillars rising above a lush tropical rainforest canopy, moss and vines on the stone, misty forest ridges fading in the background, dark bronze shadows and amber sunlight through humid afternoon air. Clean readable composition at thumbnail size, fine brushwork, deliberately distinct original setting. No text, frames, interface, or existing game artwork.

## Run an encounter

Open **Play** to try the original practice yard, or open the **5etools archive** controls and choose the supplied ZIP. On the local server, **Use supplied archive** opens the adjacent file. The browser keeps the archive with IndexedDB and saves combat per map in local storage. The hosted build includes a spell and weapon index and SRD reference material.

Wayfarer populates linked map rooms as the map opens. It uses source counts for creatures clearly placed in a room and finds free squares inside the room polygon. Creature tokens use the matching 5etools token art, linked bestiary illustrations, or art inherited from their source entry. Saved creatures can look up artwork from their original room and stat block. In Cragmaw Hideout, Sildar and the chained wolves begin neutral. Use **Set wolves hostile** in the kennel when the encounter calls for it. Other creature references remain available in Setup for manual placement. Treasure, traps, hazards, and objects can appear as room markers. Use **Inspect room** in Table tools to read a marker and reveal it when appropriate. Each map keeps its token positions, defeated creatures, and revealed markers when revisited.

Wayfarer loads the selected map’s artwork from the attached archive or the 5etools image sources. Use **Choose map image** for a local copy when needed. The grid renderer uses each square map’s source spacing, distance, and resize-adjusted offsets. When the image has a clear repeating grid near that alignment, Wayfarer refines the fit against the artwork. Movement continues to use 5-foot cells, including on maps printed at larger scales.

Under **Grid alignment** in Setup or Table tools, choose **Artwork only**, **Artwork guides**, or **5-foot cells**. The artwork’s printed lines are the default when an image loads. Adjust the pixel spacing and offsets to preview a correction, then save it for that map or reset to automatic. The grid tools also support blocked squares and difficult terrain.

**Enter game** opens the play screen. Select a party portrait for its live sheet, inventory, and remaining slots. Pick a square to explore. Wayfarer rolls initiative when a party member reaches an enemy’s sight or engages it. In combat, point at a square to see what it costs to reach and how much movement will remain. On touch screens, select a square and confirm **Move here**.

Hostile NPCs take their turns automatically in both the game screen and combat started from Setup. They use imported weapon attacks and follow the 2014 5e movement limits, walls, weapon ranges, and action economy. The game resolves hostile opportunity attacks and prompts the appropriate player for a party opportunity attack. Roll results appear in the combat log.

The **Story** journal opens with the area objective and adds the first player-facing read-aloud passage as the party enters each mapped room that has one. In Cragmaw Hideout, clear Sildar’s room and move beside him to free him and learn where Gundren may have been taken. Branching dialogues, scripted encounters, and quest transitions elsewhere require adventure-specific game logic.

Fog of war is on when you enter a game. A soft gradient blends visible, explored, and uncharted ground. Creatures follow actual line of sight. Cragmaw Hideout and its player map load prepared walls and sight blockers, with the camera starting near the party. Other maps use sight range, tagged rooms where available, and blocked squares. The party shares visibility across browsers, and the encounter saves explored squares with the party’s positions.

Weapons, spells, and items appear in the action bar. Select a spell, choose an appropriate slot and targets, and cast. The automated effects cover Sacred Flame, Poison Spray, Fire Bolt, Ray of Frost, Vicious Mockery, Eldritch Blast, Mind Sliver, Healing Word, Cure Wounds, the standard False Life, Armor of Agathys, Misty Step, Aid, and Fireball. For other spells, open **Spell rules**, resolve the effect at the table, and use **Record manual cast** when available. Workbook-specific charges and free casts follow table rulings. In Setup, edit token slots and spell modifiers. Re-import a workbook to capture its slot values on newly added tokens.

The rules layer runs locally in the browser. [SRD attribution](dist/assets/srd-attribution.txt).

## Play together

In the game screen, open **Multiplayer** and choose **Start shared session**. Sign in to host, choose a username, and copy the invite link from **Session**. Guests choose a username when they first join through the invite link or through **Join a shared session** in Setup. A returning browser keeps its username. The **Session** button shows how many players are online. Open it to see who joined and which character each player claimed.

Up to four characters can join a party. Each player can use **Claim** next to a portrait to reserve a character in their browser. Unclaimed party members are available to everyone. The map, story discoveries, tokens, initiative, and rolls sync across browsers. Each player controls their camera and tool selection. Between encounters, use **Session → Add to party** to share a character from your local library. Creating a session copies the active encounter and leaves its solo save available.

Open **Chat** on the right side of a shared game. Messages use your claimed character’s name or your username. Minimize the panel to see more of the map. The tab shows unread messages, and the session keeps its latest 200 messages when players rejoin.

The hosted Worker stores encounters and chat in D1 and shared uploaded maps in R2. The Python preview serves the solo game and local sample files. To develop the multiplayer API locally, build with `node scripts/build.mjs`, apply the `drizzle/` SQL migrations in order to the local `DB` with Wrangler, and run `wrangler dev --local --config dist/server/wrangler.json`. Hosted requests receive identity from Sites. Local API tests supply a mock `oai-authenticated-user-id` header.
