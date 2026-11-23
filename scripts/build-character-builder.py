"""Build creation selectors directly from the supplied local 5etools data."""
import importlib.util, json, argparse, re
from pathlib import Path

spec = importlib.util.spec_from_file_location('character_index', Path(__file__).with_name('build-character-rules.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

p = argparse.ArgumentParser()
p.add_argument('source')
p.add_argument('--output', default='dist/character-builder-data.json')
args = p.parse_args()

m.ORIGIN_FIELDS += ('ability', 'startingEquipment', 'entries', 'additionalSpells', 'traitTags')
s = m.RulesSource(args.source)
indexed = m.build(s)
races = s.read('races.json')
base = {(r['name'], r['source']): r for r in races['race']}

sub_map = {}
for sub in races.get('subrace', []):
    if any(sub.get('source', '').startswith(p) for p in ['UA', 'PS', 'WoW', 'AU']):
        continue
    pk = (sub.get('raceName') or '', sub.get('raceSource') or '')
    sub_map.setdefault(pk, []).append(sub)

def make_subrace(parent, sub, all_subs):
    sub_name = sub.get('name')
    sub_source = sub.get('source', parent.get('source'))
    if not sub_name:
        display_name = 'Standard'
        sub_id = 'standard'
    else:
        p_name = parent['name']
        if sub_name == 'Variant' and p_name == 'Human':
            display_name = 'Variant Human'
        elif p_name in ['Elf', 'Dwarf', 'Gnome', 'Halfling'] and not sub_name.lower().endswith(p_name.lower()):
            display_name = f"{sub_name} {p_name}"
        else:
            display_name = sub_name
        same_name = [x for x in all_subs if x.get('name') == sub_name]
        if len(same_name) > 1 and sub_source != parent.get('source'):
            display_name += f" ({sub_source})"
        sub_id = re.sub(r'[^a-z0-9]+', '-', (display_name if len(same_name) <= 1 else f"{display_name}-{sub_source}").lower()).strip('-')

    sub_rec = {
        'id': sub_id,
        'name': display_name,
        'source': sub_source,
        'traits': m.traits(sub),
    }
    for field in ['ability', 'overwrite', 'speed', 'darkvision', 'resist',
                  'skillProficiencies', 'languageProficiencies', 'toolProficiencies',
                  'weaponProficiencies', 'armorProficiencies', 'feats',
                  'additionalSpells', 'entries']:
        if sub.get(field) is not None:
            sub_rec[field] = sub[field]
    if parent.get('name') == 'Shifter':
        sub_rec.pop('ability', None)
    return sub_rec

FLEXIBLE_ASI = [
    {'choose': {'weighted': {'from': ['str', 'dex', 'con', 'int', 'wis', 'cha'], 'weights': [2, 1]}}},
    {'choose': {'weighted': {'from': ['str', 'dex', 'con', 'int', 'wis', 'cha'], 'weights': [1, 1, 1]}}}
]

species_list = []
for r in races['race']:
    if 'NPC Race' in (r.get('traitTags') or []):
        continue
    resolved = m.resolve(base, r)
    rec = m.origin(resolved)
    for field in m.ORIGIN_FIELDS:
        if field in resolved and field not in rec:
            rec[field] = resolved[field]

    # Check 2024 lineages
    if rec.get('source') == 'XPHB' and rec['name'] == 'Elf':
        rec['subraces'] = [
            {'id': 'high-elf', 'name': 'High Elf', 'source': 'XPHB',
             'additionalSpells': [sp for sp in r.get('additionalSpells', []) if sp.get('name') == 'High Elf'],
             'entries': [e for e in r.get('entries', []) if isinstance(e, dict) and 'High' in e.get('name', '')]},
            {'id': 'wood-elf', 'name': 'Wood Elf', 'source': 'XPHB', 'speed': 35,
             'additionalSpells': [sp for sp in r.get('additionalSpells', []) if sp.get('name') == 'Wood Elf'],
             'entries': [e for e in r.get('entries', []) if isinstance(e, dict) and 'Wood' in e.get('name', '')]},
            {'id': 'drow', 'name': 'Drow', 'source': 'XPHB', 'darkvision': 120,
             'additionalSpells': [sp for sp in r.get('additionalSpells', []) if sp.get('name') == 'Drow'],
             'entries': [e for e in r.get('entries', []) if isinstance(e, dict) and 'Drow' in e.get('name', '')]}
        ]
    elif rec.get('source') == 'XPHB' and rec['name'] == 'Gnome':
        rec['subraces'] = [
            {'id': 'forest-gnome', 'name': 'Forest Gnome', 'source': 'XPHB',
             'additionalSpells': [sp for sp in r.get('additionalSpells', []) if sp.get('name') == 'Forest Gnome'],
             'entries': [e for e in r.get('entries', []) if isinstance(e, dict) and 'Forest' in e.get('name', '')]},
            {'id': 'rock-gnome', 'name': 'Rock Gnome', 'source': 'XPHB',
             'additionalSpells': [sp for sp in r.get('additionalSpells', []) if sp.get('name') == 'Rock Gnome'],
             'entries': [e for e in r.get('entries', []) if isinstance(e, dict) and 'Rock' in e.get('name', '')]}
        ]
    elif rec.get('source') == 'XPHB' and rec['name'] == 'Tiefling':
        rec['subraces'] = [
            {'id': 'abyssal', 'name': 'Abyssal', 'source': 'XPHB', 'resist': ['poison'],
             'additionalSpells': [sp for sp in r.get('additionalSpells', []) if sp.get('name') == 'Abyssal'],
             'entries': [e for e in r.get('entries', []) if isinstance(e, dict) and 'Abyssal' in e.get('name', '')]},
            {'id': 'chthonic', 'name': 'Chthonic', 'source': 'XPHB', 'resist': ['necrotic'],
             'additionalSpells': [sp for sp in r.get('additionalSpells', []) if sp.get('name') == 'Chthonic'],
             'entries': [e for e in r.get('entries', []) if isinstance(e, dict) and 'Chthonic' in e.get('name', '')]},
            {'id': 'infernal', 'name': 'Infernal', 'source': 'XPHB', 'resist': ['fire'],
             'additionalSpells': [sp for sp in r.get('additionalSpells', []) if sp.get('name') == 'Infernal'],
             'entries': [e for e in r.get('entries', []) if isinstance(e, dict) and 'Infernal' in e.get('name', '')]}
        ]
    else:
        subs = sub_map.get((r['name'], r['source']), [])
        if not subs and r['name'] == 'Shifter':
            subs = sub_map.get(('Shifter', 'ERLW'), [])
        if subs:
            rec['subraces'] = [make_subrace(r, s, subs) for s in subs]

    # Populate flexible ASI for Shifter (player choice across all variants) and post-Tasha species
    if rec['name'] == 'Shifter':
        rec['ability'] = FLEXIBLE_ASI
        for sub in rec.get('subraces', []):
            sub.pop('ability', None)
    elif rec.get('edition') == '2014':
        has_sub_ability = rec.get('subraces') and any(s.get('ability') for s in rec['subraces'])
        if not rec.get('ability') and not has_sub_ability:
            rec['ability'] = FLEXIBLE_ASI

    species_list.append(rec)

classes = []
for filename in s.read('class/index.json').values():
    for c in s.read('class/' + filename).get('class', []):
        if any(c['name'] == a['name'] and c['source'] == a['source'] for a in indexed['classes']):
            classes.append({**m.select(c, 'name source startingEquipment primaryAbility'), 'hitDie': c.get('hd', {}).get('faces', 8)})

items = [*s.read('items-base.json').get('baseitem', []), *s.read('items.json').get('item', [])]
equipment = [m.select(i, 'name source type weight value weaponCategory property dmg1 dmg2 dmgType range ac armor strength packContents scfType')
             for i in items if i.get('rarity', 'none') == 'none' and not i.get('bonusWeapon') and not i.get('bonusAc')]

result = {'version': '5etools-v2.41.2', 'species': species_list, 'backgrounds': indexed['backgrounds'], 'classes': classes, 'equipment': equipment}
Path(args.output).write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
print('Creation data:', len(result['species']), 'species,', len(result['backgrounds']), 'backgrounds,', len(classes), 'classes,', len(equipment), 'equipment records')
