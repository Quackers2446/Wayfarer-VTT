"""Index character-creation mechanics from the supplied 5etools archive."""

import argparse
import json
import re
from pathlib import Path
from zipfile import ZipFile


ORIGIN_FIELDS = (
    "name", "source", "size", "speed", "darkvision", "resist", "skillProficiencies",
    "languageProficiencies", "toolProficiencies", "weaponProficiencies", "armorProficiencies", "feats",
)
CLASS_SOURCES = {"PHB", "XPHB", "TCE", "EFA"}
GENERAL_TRAITS = {"Age", "Alignment", "Size", "Speed", "Darkvision", "Languages", "Ability Score Increase"}


def edition(record):
    return "2024" if record.get("edition") == "one" or record.get("source") in {"XPHB", "EFA"} else "2014"


def resolve(records, record, chain=()):
    if "_copy" not in record:
        return record
    copy = record["_copy"]
    identity = (copy["name"], copy["source"])
    parent = records.get(identity)
    if not parent or identity in chain:
        return record
    # Inherit untouched mechanical fields. Leave source-specific mutations to the source sheet.
    excluded = set(copy.get("_mod", {}))
    parent = {} if "*" in excluded else resolve(records, parent, (*chain, identity))
    return {**{key: value for key, value in parent.items() if key not in excluded}, **record}


def label(text):
    return re.sub(r"\{@\w+ ([^{}]+)\}", lambda m: m[1].split("|")[-1], text)


def traits(record, background=False):
    names = (entry.get("name", "") for entry in record.get("entries", []) if isinstance(entry, dict))
    if background:
        return [name.removeprefix("Feature: ") for name in names if name.startswith("Feature: ")]
    return [name for name in names if name and name not in GENERAL_TRAITS]


def species_spells(record):
    def extract(nodes, usage=""):
        if isinstance(nodes, list):
            for node in nodes:
                if isinstance(node, str) and not node.startswith("{"):
                    spell, _, suffix = node.partition("#")
                    name, _, source = spell.partition("|")
                    yield (name, source, "Cantrip" if suffix == "c" else usage)
        elif isinstance(nodes, dict):
            for key, value in nodes.items():
                if key in {"_", "will", "ritual"}:
                    yield from extract(value, {"will": "At will", "ritual": "Ritual"}.get(key, usage))
                elif key in {"daily", "rest"} and isinstance(value, dict):
                    for count, entries in value.items():
                        times = count.rstrip("e")
                        if times.isdigit() or times == "pb":
                            period = "long rest" if key == "daily" else "short rest"
                            amount = "Proficiency bonus" if times == "pb" else times
                            yield from extract(entries, f"{amount} per {period}")

    options = []
    for option in record.get("additionalSpells", []):
        spells = set()
        for category in ("known", "innate", "prepared"):
            for level, entries in option.get(category, {}).items():
                if level.isdigit() or level == "_":
                    spells.update((int(level) if level.isdigit() else 1, *spell) for spell in extract(entries))
        options.append(spells)
    return sorted(set.intersection(*options)) if options else []


def origin(record, background=False):
    return {
        **{key: record[key] for key in ORIGIN_FIELDS if key in record},
        "edition": edition(record),
        "traits": traits(record, background),
        **({"spells": species_spells(record)} if record.get("additionalSpells") and not background else {}),
    }


def features(records, source, position, key):
    unlocked = []
    for record in records:
        entry = record.get(key, "") if isinstance(record, dict) else record
        parts = entry.split("|")
        if len(parts) <= position or not parts[position].isdigit():
            continue
        feature_source = parts[position + 1] if len(parts) > position + 1 else ""
        if (feature_source and feature_source != source) or parts[0].startswith("Optional Rule:"):
            continue
        unlocked.append([int(parts[position]), label(parts[0])])
    return unlocked


def spell_table(record, key):
    for table in record.get(key, []):
        if table.get("rowsSpellProgression"):
            return table["rowsSpellProgression"]
        columns = table.get("colLabels", [])
        if "Spell Slots" in columns and "Slot Level" in columns:
            slots, level = columns.index("Spell Slots"), columns.index("Slot Level")
            return [dict(pact=[int(re.search(r"\d+", str(row[level]))[0]), row[slots]]) for row in table["rows"]]
    return []


def build(archive):
    root = next(name for name in archive.namelist() if name.endswith("data/races.json"))[:-len("races.json")]
    read = lambda filename: json.loads(archive.read(root + filename))
    races = read("races.json")
    base = {(x["name"], x["source"]): x for x in races["race"] if "name" in x}
    species = [origin(resolve(base, record)) for record in base.values()]
    for variant in races["subrace"]:
        parent = base.get((variant.get("raceName"), variant.get("raceSource")))
        if not parent or not variant.get("name"):
            continue
        parent = resolve(base, parent)
        name = variant["name"]
        race = parent["name"]
        combined = {**parent, **variant, "name": f"{name} {race}"}
        if isinstance(parent.get("speed"), dict) and isinstance(variant.get("speed"), dict):
            combined["speed"] = {**parent["speed"], **variant["speed"]}
        updated = origin(combined)
        updated["aliases"] = [f"{race} {name}", f"{race} {name} {race}"]
        if name.lower().endswith(race.lower()) or variant.get("_isBaseRace"):
            updated["aliases"].append(name)
        updated["traits"] = list(dict.fromkeys(traits(parent) + traits(variant)))
        species.append(updated)
    for canonical, aliases in {"Drow Elf": ["Drow", "Dark Elf"], "Duergar Dwarf": ["Gray Dwarf", "Grey Dwarf"]}.items():
        for record in species:
            if record["name"] == canonical:
                record.setdefault("aliases", []).extend(aliases)

    # The 2024 archive lists these lineages as options on their parent species.
    # Keep the numeric benefits from the lineage tables with the named selections.
    lineages = {
        "Elf": {"Drow": {"darkvision": 120}, "High Elf": {}, "Wood Elf": {"speed": 35}},
        "Gnome": {"Forest Gnome": {}, "Rock Gnome": {}},
        "Tiefling": {"Abyssal": {"resist": ["poison"]}, "Chthonic": {"resist": ["necrotic"]},
                     "Infernal": {"resist": ["fire"]}},
    }
    for race, variants in lineages.items():
        parent = base[(race, "XPHB")]
        for option in parent.get("additionalSpells", []):
            name = option.get("name")
            if name not in variants:
                continue
            short = name.removesuffix(" " + race)
            display = name if name.endswith(race) or name == "Drow" else f"{name} {race}"
            record = origin({**parent, **variants[name], "name": display, "additionalSpells": [option]})
            record["aliases"] = [f"{race} {short}", f"{race} {name}"] + (["Dark Elf", "Drow Elf"] if name == "Drow" else [])
            species.append(record)

    records = {(x["name"], x["source"]): x for x in read("backgrounds.json")["background"] if "name" in x}
    backgrounds = [origin(resolve(records, record), background=True) for record in records.values()]
    classes = []
    for filename in read("class/index.json").values():
        data = read("class/" + filename)
        for cls in data.get("class", []):
            source = cls.get("source")
            if source not in CLASS_SOURCES or not cls.get("hd"):
                continue
            record = {key: cls[key] for key in ("name", "source", "proficiency", "casterProgression", "spellcastingAbility") if key in cls}
            record.update(edition=edition(cls), hitDie=cls["hd"]["faces"],
                          features=features(cls.get("classFeatures", []), source, 3, "classFeature"),
                          slots=spell_table(cls, "classTableGroups"))
            for key, entries in cls.get("startingProficiencies", {}).items():
                if key in {"armor", "weapons", "tools", "skills"}:
                    record[key] = [label(entry) if isinstance(entry, str) else entry for entry in entries]
            record["subclasses"] = [dict(
                name=subclass["name"], shortName=subclass.get("shortName", subclass["name"]), source=subclass["source"],
                features=features(subclass["subclassFeatures"], subclass["source"], 5, "subclassFeature"),
                casterProgression=subclass.get("casterProgression"), spellcastingAbility=subclass.get("spellcastingAbility"),
                slots=spell_table(subclass, "subclassTableGroups"),
            ) for subclass in data.get("subclass", [])
                if subclass.get("classSource") == source and subclass.get("subclassFeatures") and not subclass.get("isReprinted")]
            classes.append(record)
    return {"species": species, "backgrounds": backgrounds, "classes": classes}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "dist" / "character-rules.json")
    args = parser.parse_args()
    with ZipFile(args.archive) as archive:
        data = build(archive)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
