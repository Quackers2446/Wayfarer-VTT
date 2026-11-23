"""Build creation selectors directly from the supplied local 5etools data."""
import importlib.util,json,argparse
from pathlib import Path
spec=importlib.util.spec_from_file_location('character_index',Path(__file__).with_name('build-character-rules.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('--output',default='dist/character-builder-data.json');args=p.parse_args()
m.ORIGIN_FIELDS+=('ability','startingEquipment','entries','additionalSpells','traitTags')
s=m.RulesSource(args.source);indexed=m.build(s)
races=s.read('races.json');base={(r['name'],r['source']):r for r in races['race']}
# Subraces add their ability increases and inherited languages/proficiencies.
for sub in races['subrace']:
 parent=base.get((sub.get('raceName'),sub.get('raceSource')))
 if not parent:continue
 if not sub.get('name'):
  record=next((r for r in indexed['species'] if r['name']==parent['name'] and r['source']==parent['source']),None)
  if record:record.update({k:v for k,v in sub.items() if k in m.ORIGIN_FIELDS and k!='source'})
  continue
 record=next((r for r in indexed['species'] if r['name']==sub['name']+' '+parent['name'] and r['source']==sub['source']),None)
 if not record:continue
 for field in ['languageProficiencies','skillProficiencies','toolProficiencies','weaponProficiencies','armorProficiencies']:
  record[field]=(sub.get(field) or []) if sub.get('overwrite',{}).get(field) else (parent.get(field) or [])+(sub.get(field) or [])
 if parent.get('ability') and sub.get('ability') and not sub.get('overwrite',{}).get('ability'):
  record['ability']=[{**a,**b,**{k:a.get(k,0)+b.get(k,0) for k in ['str','dex','con','int','wis','cha'] if k in a or k in b}} for a in parent['ability'] for b in sub['ability']]
 record['additionalSpells']=(sub.get('additionalSpells') or []) if sub.get('overwrite',{}).get('additionalSpells') else (parent.get('additionalSpells') or [])+(sub.get('additionalSpells') or [])
 record['entries']=parent.get('entries',[])+sub.get('entries',[])
required_parents={(sub['raceName'],sub['raceSource']) for sub in races['subrace'] if sub.get('name') and sub.get('source')==sub.get('raceSource')}
base_variants={(sub['raceName'],sub['raceSource']) for sub in races['subrace'] if not sub.get('name')}
indexed['species']=[r for r in indexed['species'] if (r['name'],r['source']) not in required_parents-base_variants]
# Base races requiring a subrace are represented by the complete, named subrace instead.
indexed['species']=[r for r in indexed['species'] if not(r['source']=='PHB' and r['name'] in ['Elf','Dwarf','Gnome','Halfling']) and not(r['source']=='XPHB' and r['name'] in ['Elf','Gnome','Tiefling'])]
classes=[]
for filename in s.read('class/index.json').values():
 for c in s.read('class/'+filename).get('class',[]):
  if any(c['name']==a['name'] and c['source']==a['source'] for a in indexed['classes']):
   classes.append({**m.select(c,'name source startingEquipment primaryAbility'), 'hitDie':c.get('hd',{}).get('faces',8)})
items=[*s.read('items-base.json').get('baseitem',[]),*s.read('items.json').get('item',[])]
equipment=[m.select(i,'name source type weight value weaponCategory property dmg1 dmg2 dmgType range ac armor strength packContents scfType') for i in items if i.get('rarity','none')=='none' and not i.get('bonusWeapon') and not i.get('bonusAc')]
indexed['species']=[r for r in indexed['species'] if 'NPC Race' not in (r.get('traitTags') or [])]
result={'version':'5etools-v2.41.2','species':indexed['species'],'backgrounds':indexed['backgrounds'],'classes':classes,'equipment':equipment}
Path(args.output).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
print('Creation data:',len(result['species']),'species,',len(result['backgrounds']),'backgrounds,',len(classes),'classes,',len(equipment),'equipment records')
