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
// Crossbows reuse the BLFX Simple arrow clips (bolt catalogue previews were weak / disliked).
const shotClips = {arrow:[5,15,30,60,90],'throw-dagger':[15,30,60,90]};
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
  const family = /crossbow|bow$|^arrow$/.test(type??'') ? 'arrow'
    : type==='dagger' ? 'throw-dagger' : '';
  const range = shotClips[family]?.find(feet => feet >= distance);
  if(range) return {name:family+'-'+range, motion:'projectile', range, family};
  const drawn = thrown[type] ?? {arrow:'arrow','throw-dagger':'dagger'}[family];
  return drawn ? {motion:'drawn-projectile', drawn} : null;
}

function clipFor(weapon, distance) {
  const name = ruleKey(weapon.name);
  const type = weaponType(weapon, name);
  if (weapon.normalRange || /\bthrown\b/.test(name)) return projectile(type, distance);
  if (/\bhestias fury\b/.test(name)) return {name:'flame-blade', motion:'swing'};
  if (/\btentacle\b/.test(name)) return {name:'tentacle', motion:'impact'};
  if (/\bastral arms\b/.test(name)) return {name:'astral-arms', motion:'swing'};
  if (/\bunarmed strike\b/.test(name) || weapon.unarmed) return {name:'unarmed', motion:'impact'};
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
  'throw-dagger':{15:[.62,.75],30:[.62,.87],60:[.62,.99],90:[.62,1.16]},
};

export function projectilePlaybackRate(event, seconds) {
  const baseRate=1.85;
  const window=travelWindows[event.attackFamily]?.[event.attackRange];
  if(!window || seconds<window[0] || seconds>=window[1] ||
    !Number.isFinite(event.attackDistance) || event.attackDistance>=event.attackRange) return baseRate;
  return Math.min(4,baseRate*event.attackRange/Math.max(5,event.attackDistance));
}

function titleCase(name) {
  return String(name).replace(/\b\w/g, ch => ch.toUpperCase());
}

/** Local gallery / QA: every attack clip Wayfarer resolves, with the weapons that use it. */
export function attackAnimationCatalog() {
  const byClip = new Map();
  const add = (entry) => {
    const key = entry.clipKey;
    const existing = byClip.get(key);
    if (existing) {
      for (const weapon of entry.weapons) {
        if (!existing.weapons.includes(weapon)) existing.weapons.push(weapon);
      }
      return;
    }
    byClip.set(key, {...entry, weapons: [...entry.weapons]});
  };

  for (const [weapon, clip] of Object.entries(melee)) {
    add({
      clipKey: 'melee:' + clip,
      id: 'combat-' + clip,
      name: titleCase(clip.replace(/-/g, ' ')),
      group: 'melee',
      motion: 'swing',
      url: asset(clip),
      weapons: [weapon],
      note: clip === melee[weapon] && weapon !== clip ? 'Melee swing clip' : 'Melee swing',
    });
  }

  add({
    clipKey: 'special:flame-blade',
    id: 'combat-flame-blade',
    name: "Hestia's Fury / flame blade",
    group: 'special',
    motion: 'swing',
    url: asset('flame-blade'),
    weapons: ["Hestia's Fury", 'flaming melee'],
    note: 'Named / flaming melee swing',
  });
  add({
    clipKey: 'special:tentacle',
    id: 'combat-tentacle',
    name: 'Tentacle',
    group: 'special',
    motion: 'impact',
    url: asset('tentacle'),
    weapons: ['tentacle'],
    note: 'Creature tentacle impact',
  });
  add({
    clipKey: 'special:unarmed',
    id: 'combat-unarmed',
    name: 'Unarmed strike',
    group: 'special',
    motion: 'impact',
    url: asset('unarmed'),
    weapons: ['unarmed strike'],
    note: 'BLFX Claw 6 Rend — on-target slash (no low-poly arm mesh)',
  });
  add({
    clipKey: 'special:astral-arms',
    id: 'combat-astral-arms',
    name: 'Astral arms',
    group: 'special',
    motion: 'swing',
    url: asset('astral-arms'),
    weapons: ['astral arms'],
    note: 'BLFX Unarmed Strike Claw Color 2 — ethereal claw swing',
  });

  const projectileUsers = {
    arrow: ['shortbow', 'longbow', 'bow', 'arrow', 'crossbow', 'hand crossbow', 'light crossbow', 'heavy crossbow'],
    'throw-dagger': ['dagger (thrown)'],
  };
  for (const [family, ranges] of Object.entries(shotClips)) {
    for (const range of ranges) {
      const clip = family + '-' + range;
      add({
        clipKey: 'shot:' + clip,
        id: 'combat-' + clip,
        name: titleCase(family.replace(/-/g, ' ')) + ' · ' + range + ' ft',
        group: 'ranged',
        motion: 'projectile',
        family,
        range,
        url: asset(clip),
        weapons: projectileUsers[family] ?? [family],
        note: 'Projectile clip for distances up to ' + range + ' ft',
      });
    }
  }

  for (const [weapon, drawn] of Object.entries(thrown)) {
    add({
      clipKey: 'drawn:' + drawn,
      id: 'drawn-' + drawn,
      name: titleCase(weapon) + ' (thrown)',
      group: 'drawn',
      motion: 'drawn-projectile',
      drawn,
      url: '',
      weapons: [weapon],
      note: 'Board-drawn projectile (' + drawn + ') — no combat-*.webm clip',
    });
  }

  return [...byClip.values()]
    .map(entry => ({
      ...entry,
      weapons: entry.weapons.slice().sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => {
      const order = {melee: 0, ranged: 1, special: 2, drawn: 3};
      return (order[a.group] ?? 9) - (order[b.group] ?? 9)
        || (a.family || '').localeCompare(b.family || '')
        || (a.range ?? 0) - (b.range ?? 0)
        || a.name.localeCompare(b.name);
    });
}
