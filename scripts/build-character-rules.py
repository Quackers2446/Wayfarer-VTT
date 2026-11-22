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

def select(record, fields):
    return {key: record[key] for key in fields.split() if key in record}


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


class RulesSource:
    def __init__(self, source):
        self.source = Path(source)
        self.archive = None if self.source.is_dir() else ZipFile(self.source)
        self.root = (self.source / "data") if self.source.is_dir() else next(
            name for name in self.archive.namelist() if name.endswith("data/races.json"))[:-len("races.json")]

    def read(self, filename):
        raw = (self.root / filename).read_text(encoding="utf-8") if self.archive is None else self.archive.read(self.root + filename)
        return json.loads(raw)


def feature_id(feature, subclass=False):
    parts = [feature["name"], feature["className"], feature.get("classSource", "PHB")]
    if subclass:
        parts += [feature["subclassShortName"], feature.get("subclassSource", feature["source"])]
    parts += [str(feature["level"]), feature.get("source", "PHB")]
    return "|".join(parts).lower()


def reference_id(uid, subclass=False):
    parts = uid.split("|")
    if subclass:
        name, cls, cls_source, short, sub_source, level, *source = parts
        return "|".join([name, cls, cls_source or "PHB", short, sub_source or "PHB", level, (source[0] if source else "") or sub_source or "PHB"]).lower()
    name, cls, cls_source, level, *source = parts
    return "|".join([name, cls, cls_source or "PHB", level, (source[0] if source else "") or cls_source or "PHB"]).lower()


def class_data(read, files):
    data = [read("class/" + filename) for filename in files]
    definitions = {}
    for file in data:
        for field in ("classFeature", "subclassFeature"):
            for feature in file.get(field, []):
                definitions[feature_id(feature, field == "subclassFeature")] = feature

    def expand(node, chain=()):
        if isinstance(node, list):
            return [expand(item, chain) for item in node]
        if not isinstance(node, dict):
            return node
        field = "classFeature" if node.get("type") == "refClassFeature" else "subclassFeature" if node.get("type") == "refSubclassFeature" else None
        if field:
            uid = reference_id(node[field], field == "subclassFeature")
            feature = definitions.get(uid)
            if feature and uid not in chain:
                return {"type": "entries", "name": feature["name"], "source": feature["source"], "uid": uid,
                        "entries": expand(feature.get("entries", []), (*chain, uid))}
        return {key: expand(value, chain) for key, value in node.items()}

    def detail(reference, subclass=False):
        uid = reference_id(reference, subclass)
        found = definitions.get(uid)
        if not found:
            return None
        return {**select(found, "name source level consumes isClassFeatureVariant"),
                "id": uid, "entries": expand(found.get("entries", []), (uid,)),
                "optional": not subclass and found["source"] != found.get("classSource", "PHB")}

    def linked(refs, subclass=False):
        result = []
        for entry in refs:
            reference = entry.get("subclassFeature" if subclass else "classFeature") if isinstance(entry, dict) else entry
            if reference:
                found = detail(reference, subclass)
                if found:
                    result.append(found)
        return result

    classes = []
    extras = "cantripProgression spellsKnownProgression spellsKnownProgressionFixed preparedSpells preparedSpellsProgression additionalSpells optionalfeatureProgression subclassTitle classTableGroups multiclassing"
    for file in data:
        for cls in file.get("class", []):
            if not cls.get("hd"):
                continue
            record = {**select(cls, "name source proficiency casterProgression spellcastingAbility " + extras),
                      "edition": edition(cls), "hitDie": cls["hd"]["faces"], "featureDetails": linked(cls.get("classFeatures", [])),
                      "features": features(cls.get("classFeatures", []), cls["source"], 3, "classFeature"),
                      "slots": spell_table(cls, "classTableGroups")}
            for key, entries in cls.get("startingProficiencies", {}).items():
                if key in {"armor", "weapons", "tools", "skills", "toolProficiencies"}:
                    record[key] = [label(entry) if isinstance(entry, str) else entry for entry in entries]
            record["subclasses"] = []
            for sub in file.get("subclass", []):
                if sub.get("classSource", "PHB") != cls["source"] or not sub.get("subclassFeatures"):
                    continue
                record["subclasses"].append({
                    **select(sub, "name shortName source casterProgression spellcastingAbility additionalSpells optionalfeatureProgression cantripProgression spellsKnownProgression preparedSpells subclassTableGroups"),
                    "shortName": sub.get("shortName", sub["name"]), "edition": edition(cls),
                    "features": features(sub["subclassFeatures"], sub["source"], 5, "subclassFeature"),
                    "featureDetails": linked(sub["subclassFeatures"], True),
                    "slots": spell_table(sub, "subclassTableGroups"),
                })
            classes.append(record)

    optional = [select(record, "name source featureType prerequisite entries consumes additionalSpells skillProficiencies expertise languageProficiencies toolProficiencies")
                for record in read("optionalfeatures.json").get("optionalfeature", [])]
    feats = [select(record, "name source prerequisite entries ability additionalSpells skillProficiencies expertise languageProficiencies toolProficiencies")
             for record in read("feats.json").get("feat", [])]
    spells = []
    lookup = read("generated/gendata-spell-source-lookup.json")
    for filename in read("spells/index.json").values():
        for spell in read("spells/" + filename).get("spell", []):
            membership = lookup.get(spell["source"].lower(), {}).get(spell["name"].lower(), {})
            spells.append({**select(spell, "name source level school"), "edition": edition(spell),
                           "classes": membership.get("class", {}), "subclasses": membership.get("subclass", {})})
    return {"classes": classes, "optionalFeatures": optional, "feats": feats, "spells": spells}


def build(source):
    read = source.read
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
    return {"species": species, "backgrounds": backgrounds,
            **class_data(read, read("class/index.json").values())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "dist" / "character-rules.json")
    args = parser.parse_args()
    data = build(RulesSource(args.archive))
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
