import {matchWeapon,ruleKey} from './rules-library.mjs';
export function weaponProperties(attack){
 const weapon=matchWeapon(attack.baseWeapon||attack.baseName||attack.name),manual=attack.weaponPropertiesEdited;
 const notes=String(attack.note??attack.name??'');
 return {...attack,baseName:weapon?.name??attack.baseName,
  finesse:manual?Boolean(attack.finesse):Boolean(attack.finesse||weapon?.property?.includes('F')||/^hestias fury\b/.test(ruleKey(attack.name))||/\bfinesse\b/i.test(notes)&&!/(?:not|no|without) finesse/i.test(notes)),
  rangedWeapon:manual?Boolean(attack.rangedWeapon):Boolean(attack.rangedWeapon||weapon?.type==='R'),
  ...(weapon?.type==='R'&&!attack.normalRange?{normalRange:Number(weapon.range?.split('/')[0]),longRange:Number(weapon.range?.split('/')[1]??weapon.range?.split('/')[0])}:{}),
 };
}
