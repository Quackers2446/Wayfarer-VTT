import json,pathlib,sys
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '../5etools-v2.41.2/data/bestiary')
records={}
for file in root.glob('bestiary-*.json'):
 for row in json.loads(file.read_text()).get('monster',[]):records[(row['name'].lower(),row['source'].lower())]=row
sizes={}
def size(key,seen=None):
 seen=set() if seen is None else seen
 if key in seen:return 'M'
 seen.add(key);row=records.get(key,{})
 if row.get('size'):return row['size'][0]
 copy=row.get('_copy',{})
 return size((copy.get('name','').lower(),copy.get('source',key[1]).lower()),seen) if copy else 'M'
for key in records:
 value=size(key)
 if value!='M' and value in 'TSLHG':sizes['|'.join(key)]=value
out=pathlib.Path('dist/monster-sizes.mjs');out.write_text('// Size categories from the local 5etools bestiary, including inherited stat blocks.\nexport const monsterSizes='+json.dumps(sizes,separators=(',',':'),ensure_ascii=False)+';\n')
print(f'Indexed {len(records)} monsters; {len(sizes)} non-Medium sizes ({out.stat().st_size} bytes).')
print('Wolf:',size(('wolf','mm')),'Hill Giant:',size(('hill giant','mm')))
