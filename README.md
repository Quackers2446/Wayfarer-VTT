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
