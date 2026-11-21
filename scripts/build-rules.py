"""Build spell metadata, SRD references, and base weapon statistics from a 5etools ZIP."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile


def select(record, keys):
    return {key: record[key] for key in keys.split() if key in record}


def build_rules(source):
    with ZipFile(source) as archive:
        index_path = next(name for name in archive.namelist() if name.endswith("data/spells/index.json"))
        root = index_path[:-len("spells/index.json")]
        index = json.loads(archive.read(index_path))
        spells = []
        for filename in index.values():
            for spell in json.loads(archive.read(root + "spells/" + filename)).get("spell", []):
                metadata = select(spell, "name source level school time range components duration alias")
                metadata["edition"] = "2024" if spell.get("source") == "XPHB" or spell.get("edition") == "one" else "2014"
                if spell.get("srd") or spell.get("srd52"):
                    # Use the SRD name where the rules publish the spell under a different name.
                    srd_name = spell.get("srd") or spell.get("srd52")
                    if isinstance(srd_name, str):
                        metadata["srdName"] = srd_name
                    else:
                        metadata.update(select(spell, "entries entriesHigherLevel"))
                spells.append(metadata)
        weapons = []
        for item in json.loads(archive.read(root + "items-base.json")).get("baseitem", []):
            if item.get("srd") and item.get("type") in {"M", "R"} and item.get("dmg1"):
                weapons.append(select(item, "name type dmg1 dmg2 dmgType range property"))
        return {"spells": spells, "weapons": weapons}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "dist" / "rules.json")
    arguments = parser.parse_args()
    data = build_rules(arguments.archive)
    arguments.output.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Indexed {len(data['spells'])} spell records and {len(data['weapons'])} SRD weapons.")
