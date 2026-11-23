import json,pathlib
root=pathlib.Path(__file__).resolve().parents[2]/'5etools-v2.41.2/data/bestiary'
xp=[10,200,450,700,1100,1800,2300,2900,3900,5000,5900,7200,8400,10000,11500,13000,15000,18000,20000,22000,25000,33000,41000,50000,62000,75000,90000,105000,120000,135000,155000]
records={};raw={}
for p in root.glob('bestiary-*.json'):
 for m in json.load(open(p)).get('monster',[]):raw[(m.get('name','').lower(),m.get('source','').lower())]=m
def resolve(m,depth=0):
 if depth>8:return m
 c=m.get('_copy');base=resolve(raw.get((c['name'].lower(),c['source'].lower()),{}),depth+1) if c else {}
 return {**base,**m}
for (name,source),m in raw.items():
 m=resolve(m);cr=m.get('cr');explicit_xp=cr.get('xp') if isinstance(cr,dict) else None;cr=cr.get('cr') if isinstance(cr,dict) else cr
 if cr is None:continue
 value={'1/8':25,'1/4':50,'1/2':100}.get(str(cr),xp[int(cr)] if str(cr).isdigit() and int(cr)<len(xp) else 0)
 if isinstance(explicit_xp,(int,float)):value=max(0,explicit_xp)
 items=[]
 for ref in m.get('attachedItems',[]):
  if isinstance(ref,str):
   parts=ref.split('|');items.append({'name':parts[0].title(),'reference':(parts[1] if len(parts)>1 else 'phb').lower()+'|'+parts[0].lower(),'quantity':1})
 records[name+'|'+source]={'cr':cr,'xp':value,'items':items}
(pathlib.Path(__file__).resolve().parents[1]/'dist/monster-rewards.json').write_text(json.dumps(records,separators=(',',':')))
print('Built source rewards for',len(records),'monsters')
