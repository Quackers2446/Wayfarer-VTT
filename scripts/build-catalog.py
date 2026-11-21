"""Build the browser index from a local 5etools release ZIP."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile


def map_images(value):
    if isinstance(value, list):
        for child in value:
            yield from map_images(child)
    elif isinstance(value, dict):
        if value.get("type") == "image" and value.get("imageType") in {"map", "mapPlayer"}:
            yield value
        for child in value.values():
            if isinstance(child, (dict, list)):
                yield from map_images(child)


def read_maps(archive, path):
    if path not in archive.NameToInfo:
        return []
    maps = []
    body = json.loads(archive.read(path))
    chapters = body.get("data")
    if chapters is None:
        chapters = next((record["data"] for record in body.get("adventureData", []) if "data" in record), [])
    for chapter, data in enumerate(chapters):
        seen = set()
        titles = {}
        images = list(map_images(data))
        for image in images:
            if image.get("id") and image.get("title"):
                titles[image["id"]] = image["title"]
        for image in images:
            href = image.get("href", {}).get("path")
            title = image.get("title")
            if not title and href:
                title = Path(href).stem
            parent_title = titles.get((image.get("mapParent") or {}).get("id"))
            if title == "Player Version" and parent_title:
                title = f"{parent_title} (Player)"
            key = href or title
            if not key or key in seen or not title:
                continue
            seen.add(key)
            maps.append({
                "name": title,
                "chapter": chapter,
                "player": image["imageType"] == "mapPlayer",
                "grid": image.get("grid", {}).get("type"),
            })
    return maps


def build_catalog(source):
    with ZipFile(source) as archive:
        path = next((n for n in archive.namelist() if n.endswith("data/adventures.json")), None)
        if path is None:
            raise ValueError("This archive does not contain data/adventures.json")
        prefix = path[:-len("data/adventures.json")]
        package = f"{prefix}package.json"
        version = json.loads(archive.read(package)).get("version") if package in archive.NameToInfo else None
        catalog = {"version": version}
        fields = ("id", "name", "group", "source", "published", "author", "storyline", "level")
        for key, entry_type in (("adventures", "adventure"), ("books", "book")):
            listing = json.loads(archive.read(f"{prefix}data/{key}.json"))[entry_type]
            entries = []
            for entry in listing:
                record = {field: entry[field] for field in fields if field in entry}
                record["chapters"] = [chapter["name"] for chapter in entry.get("contents", [])]
                if entry_type == "adventure":
                    filename = f"{prefix}data/adventure/adventure-{entry['id'].lower()}.json"
                    record["maps"] = read_maps(archive, filename)
                entries.append(record)
            catalog[key] = entries
        return catalog


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "dist" / "catalog.json")
    args = parser.parse_args()
    catalog = build_catalog(args.archive)
    args.output.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Indexed {len(catalog['adventures'])} adventures and {len(catalog['books'])} sourcebooks.")
