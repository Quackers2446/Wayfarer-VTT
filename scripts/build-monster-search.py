"""Build name/source suggestions from the local 5etools bestiary, without loading stat blocks in the browser."""
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path(__file__).resolve().parents[2]/'5etools-v2.41.2/data/bestiary'
records={}
for file in sorted(root.glob('bestiary-*.json')):
 for record in json.loads(file.read_text()).get('monster',[]):
  if not record.get('name') or not record.get('source'):continue
  cr=record.get('cr','');cr=cr.get('cr','') if isinstance(cr,dict) else cr
  records[(record['name'],record['source'])]={'name':record['name'],'source':record['source'],'cr':str(cr)}
output=pathlib.Path(__file__).resolve().parents[1]/'dist/monster-search.json'
output.write_text(json.dumps(sorted(records.values(),key=lambda r:(r['source']!='MM',r['name'],r['source'])),separators=(',',':'),ensure_ascii=False))
print(f'Built {len(records)} monster search records')
