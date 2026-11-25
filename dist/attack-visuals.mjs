import {ruleKey} from './rules-library.mjs';
import {creatureSize} from './actor-space.mjs';

const asset = name => '/assets/animations/combat-'+name+'.webm';
const melee = {
  battleaxe:'battleaxe', club:'club', dagger:'dagger', flail:'flail', glaive:'glaive',
  greataxe:'greataxe', greatclub:'greatclub', greatsword:'greatsword', halberd:'halberd',
  handaxe:'handaxe', javelin:'spikes', lance:'spikes', 'light hammer':'hammer',
  longsword:'longsword', mace:'mace', maul:'maul', morningstar:'mace', pike:'spikes',
  quarterstaff:'staff', rapier:'rapier', scimitar:'scimitar', shortsword:'shortsword',
  sickle:'sickle', spear:'spikes', trident:'spikes', 'war pick':'hammer', warhammer:'warhammer',
  whip:'flail', naginata:'glaive', katana:'katana', staff:'staff', spikes:'spikes',
};
const shotClips = {arrow:[5,15,30,60,90],bolt:[5,15,30,60,90],'throw-dagger':[15,30,60,90]};
const thrown = {
  'light hammer':'hammer', handaxe:'axe', dart:'dart', blowgun:'needle',
  sling:'stone', javelin:'spear', spear:'spear', trident:'trident',
};
const weaponNames = [...new Set([
  ...Object.keys(melee), ...Object.keys(thrown),
  'shortbow','longbow','bow','arrow','crossbow','hand crossbow','light crossbow','heavy crossbow',
])].sort((a,b)=>b.length-a.length);

function weaponType(weapon, name) {
  const base = ruleKey(weapon.baseWeapon || weapon.baseName || '');
  if(weaponNames.includes(base)) return base;
  return weaponNames.find(key => new RegExp('\\b'+key+'s?\\b').test(name));
}

function projectile(type, distance) {
  const family = /crossbow/.test(type??'') ? 'bolt' : /bow$|^arrow$/.test(type??'') ? 'arrow' : type==='dagger' ? 'throw-dagger' : '';
  const range = shotClips[family]?.find(feet => feet >= distance);
  if(range) return {name:family+'-'+range, motion:'projectile', range, family};
  const drawn = thrown[type] ?? {arrow:'arrow',bolt:'bolt','throw-dagger':'dagger'}[family];
  return drawn ? {motion:'drawn-projectile', drawn} : null;
}

function clipFor(weapon, distance) {
  const name = ruleKey(weapon.name);
  const type = weaponType(weapon, name);
  if (weapon.normalRange || /\bthrown\b/.test(name)) return projectile(type, distance);
  if (/\bhestias fury\b/.test(name)) return {name:'flame-blade', motion:'swing'};
  if (/\btentacle\b/.test(name)) return {name:'tentacle', motion:'impact'};
  if (/\b(?:unarmed strike|astral arms)\b/.test(name) || weapon.unarmed) return {name:'unarmed', motion:'swing'};
  if (melee[type]) return {name:melee[type], motion:'swing', fire:/\bflaming\b/.test(name)};
  return null;
}

export function attackVisual(weapon, attacker, target, distance) {
  const clip = clipFor(weapon, distance);
  if (!clip || ![attacker.x,attacker.y,target.x,target.y].every(Number.isFinite)) return {};
  const point = actor => ({x:actor.x,y:actor.y,creatureSize:creatureSize(actor)});
  return {
    visual:{url:clip.name?asset(clip.name):'',kind:'burst',scale:1,
      duration:clip.motion==='impact'?1450:clip.motion==='projectile'?2300:1300},
    attackMotion:clip.motion,attackRange:clip.range,attackFamily:clip.family,
    attackDistance:distance,attackProjectile:clip.drawn,attackFire:clip.fire,
    visualFrom:point(attacker),visualPoint:point(target),
  };
}

// Source timestamps leave the launch and the impact at the ordinary playback rate.
const travelWindows = {
  arrow:{15:[.39,.54],30:[.39,.55],60:[.39,.73],90:[.39,1.03]},
  bolt:{15:[.75,.88],30:[.75,1.05],60:[.75,1.25],90:[.75,1.4]},
  'throw-dagger':{15:[.62,.75],30:[.62,.87],60:[.62,.99],90:[.62,1.16]},
};

export function projectilePlaybackRate(event, seconds) {
  const baseRate=1.85;
  const window=travelWindows[event.attackFamily]?.[event.attackRange];
  if(!window || seconds<window[0] || seconds>=window[1] ||
    !Number.isFinite(event.attackDistance) || event.attackDistance>=event.attackRange) return baseRate;
  return Math.min(4,baseRate*event.attackRange/Math.max(5,event.attackDistance));
}
