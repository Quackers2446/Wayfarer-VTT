# Wayfarer

Wayfarer is a 5e campaign setup dashboard for importing character workbooks and selecting an adventure. The browser saves your party and active adventure on the device and origin where you imported them.

## Run locally

From the `wayfarer` folder, run `python3 scripts/serve.py` and open <http://127.0.0.1:5173/>. On the Character sheets page, **Import supplied sheets** uses the workbooks in the adjacent `Character Sheets` folder. That folder is outside the deployment directory. You can also serve `dist` with any static HTTP server and upload workbooks manually.

## Import a character

Use **Import character** to select or drop one or more `.xlsx` files, including Excel exports from Google Sheets. The importer supports the supplied v1.3 and v1.4 layouts and simple sheets with labels such as Character Name, Class, Species, Level, Armor Class, Hit Points, and Strength. Simple sheets can use a two-column label/value layout or a header row with the values directly beneath it. The importer reads spreadsheet values saved by Excel or Google Sheets. Re-export a workbook with missing calculated results to restore its formula values.

You can also paste a Google Sheets link with viewer access for anyone with the link. For a restricted workbook, export it using **File → Download → Microsoft Excel (.xlsx)** and upload the file. The Google Sheets link points directly to Google's export endpoint.

## Refresh the catalog

Run `python3 scripts/build-catalog.py /path/to/5etools.zip` from this folder. The committed index contains bibliographic data, chapter titles, and map references from the supplied 5etools v2.41.2 ZIP. Map images live in the separate 5etools image pack. The dashboard art is original, generated for Wayfarer.

The current dashboard covers campaign setup. Grid gameplay and AI-assisted encounter mapping are future milestones.

## Artwork

The built-in ImageGen tool created the four original dashboard scenes in `dist/assets`. These are the prompts used for the selected JPEGs.

- **hero.jpg** — Create an original panoramic 3:1 medieval fantasy landscape background for a dark forest-green campaign organizer web dashboard. Painterly realistic classical oil landscape with fine brushwork, editorial and tasteful, Old World verdigris shadows, warm muted gold clouds. Left half dark shaded pine ridge, dim tree silhouettes and near-black evergreen atmosphere so overlaid cream UI text reads. Right half shows a winding pale river leading to a small ruined stone hilltop citadel, rocky alpine spires, low warm atmospheric sun on the skyline, textured pine forests. Frame it from a valley overlook, wide screen, horizon at upper middle. Moody, atmospheric and calm, gold and evergreen toned. No lettering, UI, icon, border, people, or any reference to an existing game.
- **forest.jpg** — Original high-end medieval fantasy environment key art, horizontal wide 3:2. An ancient half buried stone arch in a mossy ravine and dense pine forest, a warm late afternoon ray piercing the green shadow. Fern and rocky foreground with a distant footpath. Classical realistic oil painting, warm weathered greens, grounded, strong clean readable composition at thumbnail size, softly textured brushwork. No text, frames, interface, people, existing game artwork.
- **castle.jpg** — Original realistic classical oil painting landscape for a tabletop medieval fantasy campaign card, horizontal wide 3:2. One pointed gothic stone castle on a remote rocky pinnacle in an expansive misty valley, distant bats as tiny silhouettes, mauve sky and glowing blood-orange autumn clouds, faded crimson autumn trees. Clean readable composition at thumbnail size. Twilight, weathered textures, moody. No text, frames, interface, existing game artwork.
- **jungle.jpg** — Original realistic classical oil painting landscape for a tabletop fantasy campaign card, horizontal wide 3:2. Enormous ancient sandstone temple gates and monumental weathered pillars rising above a lush tropical rainforest canopy, moss and vines on the stone, misty forest ridges fading in the background, dark bronze shadows and amber sunlight through humid afternoon air. Clean readable composition at thumbnail size, fine brushwork, deliberately distinct original setting. No text, frames, interface, or existing game artwork.

## Run an encounter

Open **Play** to try the original practice yard, or open the **5etools archive** controls and choose the supplied ZIP. On the local server, **Use supplied archive** opens the adjacent file. The browser keeps the archive with IndexedDB and saves combat per map in local storage. The hosted build includes a spell and weapon index and SRD reference material.

In Lost Mine of Phandelver, choose **Cragmaw Hideout** and a room from the grid or area selector. The six rooms with starting enemies have authored rosters. Other square-grid maps link room polygons and show creatures tagged in the room entry for manual placement. You can select a party member or add individual monsters by name and source code. Attach the matching map image if you have it, then use the terrain tools to mark walls and difficult squares. The drawn polygons mark source areas. Mark blocked squares and difficult terrain with the grid tools.

**Roll initiative** to start a turn order. Select an attack, spell, or item and a target where applicable. Combat uses 2014-style d20 initiative and attack rolls, 5-foot squares, movement costs, advantage and disadvantage, cover, critical damage, death saves, and manual decisions on opportunity attacks. Tokens and HP in **Play** are encounter state. Re-import a sheet to capture spell slots from its workbook or set the slots on the token before rolling initiative. Extra Attack and custom weapon formulas can also be set at the table.

Spell references match the 5etools entry by name and prefer the 2014 version. Automated combat spells cover Sacred Flame, Poison Spray, Fire Bolt, Ray of Frost, Vicious Mockery, Healing Word, and Cure Wounds. Healing potions are supported as item actions. For other spells, class abilities, monster traits, and conditional triggers, use the dice roller and **Apply a manual ruling**. The rules layer runs locally in the browser. [SRD attribution](dist/assets/srd-attribution.txt).
