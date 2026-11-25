import {ruleKey} from './spell-rule-schema.mjs';
import {indexedSpellAnimations} from './spell-animation-index.mjs';
import {spellFxCatalog} from './spell-animation-supplements.mjs';
import {creatureSize} from './actor-space.mjs';

// Known-bad JB2A clips — omit from catalogs and automatic defaults.
export const brokenAnimationIds = new Set([
  '4th-level-wall-of-fire-walloffire-01-yellow-500x100',
]);

export const spellAnimations = [...indexedSpellAnimations, ...spellFxCatalog]
  .filter((clip) => !brokenAnimationIds.has(clip.id));

export const builtinSpellColors = Object.freeze({
 acid:'#b4ed51',bludgeoning:'#e2b885',cold:'#a5eaff',fire:'#ff813e',force:'#aa87ec',
 lightning:'#84ceff',necrotic:'#a163ab',piercing:'#f6bc8b',poison:'#92cc63',
 psychic:'#e995df',radiant:'#ffe58d',slashing:'#f5b795',thunder:'#a5cde7',
 charm:'#f88fb7',shimmer:'#c9e7ff',heal:'#8be4bb',
});

function builtin(color,kind='burst') {
 return {label:'Built-in spell effect',builtin:color,kind,url:'',scale:1,duration:680};
}

export function clipFeet(clip) {
 if(!clip)return null;
 const fromUrl=clip.url?.match(/(?:^|[_\-])(\d+)ft(?:[_\-.]|$)/i)?.[1];
 const fromLabel=clip.label?.match(/(\d+)\s*ft/i)?.[1];
 const fromId=clip.id?.match(/(?:^|[_\-])(\d+)ft(?:[_\-.]|$)/i)?.[1];
 const feet=Number(fromUrl||fromLabel||fromId);
 return Number.isFinite(feet)&&feet>0?feet:null;
}

// Prefer the shortest clip that covers the shot; tie-break toward already-bundled files.
export function pickDistanceClip(matches, feet) {
 if(!matches.length)return;
 const scored=matches.map(clip=>({clip,ft:clipFeet(clip),local:clip.url.startsWith('/')}))
  .filter(entry=>entry.ft!=null)
  .sort((a,b)=>a.ft-b.ft||Number(b.local)-Number(a.local));
 if(!scored.length)return matches.find(clip=>clip.url.startsWith('/'))??matches[0];
 if(!Number.isFinite(feet)){
  const thirty=scored.find(entry=>entry.ft===30&&entry.local)??scored.find(entry=>entry.local)??scored.find(entry=>entry.ft===30)??scored[0];
  return thirty.clip;
 }
 const fit=scored.find(entry=>entry.ft>=feet)??scored.at(-1);
 const same=scored.filter(entry=>entry.ft===fit.ft);
 return same.find(entry=>entry.local)?.clip??fit.clip;
}

function preferWallLine(lines) {
 if(!lines.length)return;
 // Prefer the working local yellow wall strip (VP8 300x100). Avoid 500x100 — known-broken VP9.
 return lines.find(clip=>clip.url.startsWith('/')&&/300x100/.test(clip.url)&&!/ring|75opa/i.test(clip.url))
  ??lines.find(clip=>clip.url.startsWith('/')&&/200x100/.test(clip.url)&&!/ring|75opa/i.test(clip.url))
  ??lines.find(clip=>clip.url.startsWith('/')&&!/500x100|ring|75opa/i.test(clip.url))
  ??lines.find(clip=>clip.url.startsWith('/'))
  ??lines[0];
}

function pickMatch(matches, definition, {distanceFt}={}) {
 if(!matches.length)return;
 if(definition?.shape==='ring')return matches.find(clip=>/ring/i.test(clip.url))??matches[0];
 if(definition?.shape==='wall'||definition?.shape==='line'){
  const lines=matches.filter(clip=>clip.kind==='line');
  if(lines.length)return preferWallLine(lines);
 }
 if(matches.some(clip=>clip.kind==='cone')&&definition?.shape==='cone')
  return matches.find(clip=>clip.kind==='cone'&&clip.url.startsWith('/'))??matches.find(clip=>clip.kind==='cone')??matches[0];
 const rays=matches.filter(clip=>clip.kind==='ray');
 if(rays.length&&(definition?.attack||definition?.shape==='creature'&&definition?.attack!==''))
  return pickDistanceClip(rays,distanceFt);
 if(rays.length&&Number.isFinite(distanceFt))return pickDistanceClip(rays,distanceFt);
 if(matches.some(clip=>clip.kind==='line'))return preferWallLine(matches.filter(clip=>clip.kind==='line'));
 return matches.find(clip=>clip.url.startsWith('/'))??matches[0];
}

export function defaultSpellAnimation(name,definition,options={}){
 const original=ruleKey(String(name??'').split('|').at(-1));
 const key=({'arcane hand':'bigbys hand','black tentacles':'evards black tentacles'})[original]??original;
 const matches=spellAnimations.filter(clip=>clip.spells.includes(key));
 if(key==='detect magic')return matches.find(clip=>clip.kind==='burst')??matches[0];
 const matched=pickMatch(matches,definition,options);
 if(matched)return matched;
 if(key==='charm person')return builtin('charm');
 if(key==='invisibility'||key==='greater invisibility')return builtin('shimmer');
 if(key==='exhale dragons breath')return builtin('fire','cone');
 if(!definition || definition.nativeKey || !Array.isArray(definition.effects))return;
 const effect=definition.effects.find(effect=>effect.trigger==='cast')??definition.effects[0];
 const type=effect?.damage?.[0]?.type;
 const color=effect?.kind==='healing'?'heal':effect?.condition==='Charmed'?'charm':Object.hasOwn(builtinSpellColors,type)?type:'force';
 const kind=['cone','line','wall'].includes(definition.shape)?(definition.shape==='wall'?'line':definition.shape):definition.attack?'ray':'burst';
 return builtin(color,kind==='wall'?'line':kind);
}

/** Prefer an explicit rule.visual override (including “none” with an empty url); else name/shape auto-match. */
export function resolveSpellAnimation(name,definition,options={}){
 if(definition&&Object.hasOwn(definition,'visual')&&definition.visual!=null)return structuredClone(definition.visual);
 return defaultSpellAnimation(name,definition,options);
}

/**
 * Editor animation-mode for a saved/draft visual.
 * Empty url is “none” unless mode:'custom' (Custom URL draft with a blank field).
 */
export function spellAnimationMode(visual,clips=spellAnimations){
 if(!visual)return'auto';
 if(visual.mode==='custom')return'custom';
 if(!visual.url)return'none';
 if(clips.some(clip=>clip.url===visual.url))return'catalogue';
 return'custom';
}

/** True when an explicit visual override disables all video (cast + zone loops). */
export function spellAnimationSuppressed(definition){
 if(!definition||!Object.hasOwn(definition,'visual')||definition.visual==null)return false;
 const visual=definition.visual;
 return !visual.url&&!visual.builtin;
}

export function breathAnimation(type){
 if(type==='poison')return defaultSpellAnimation('poison spray');
 if(['fire','cold'].includes(type))return defaultSpellAnimation(type+' breath');
 return builtin(Object.hasOwn(builtinSpellColors,type)?type:'fire','cone');
}

const point = actor => ({x:actor.x,y:actor.y,creatureSize:creatureSize(actor)});

export function spellVisualEvent(visual,caster,target,{square,end,length,diameter,targets=[],from}={}){
 if(!visual?.url&&!visual?.builtin)return {};
 const wall=square&&end&&visual.kind==='line';
 const origin=from??(wall?square:caster);
 const aim=wall?end:square??target??caster;
 const destination=visual.anchor==='caster'||visual.kind==='cone'?caster:aim;
 const secondary=(!square&&!from&&destination===target?targets:[]).filter(entry=>entry&&entry!==target&&Number.isFinite(entry.x)&&Number.isFinite(entry.y));
 const feet=clipFeet(visual);
 return {
  visual:structuredClone(visual),visualPoint:point(destination),visualFrom:point(origin),visualAim:point(aim),
  visualEnd:Boolean(wall),visualLength:length??visual.length,visualDiameter:diameter??visual.diameter??2,
  ...(Number.isFinite(feet)?{visualClipFeet:feet}:{}),
  ...(secondary.length?{visualTargets:secondary.slice(0,7).map(point)}:{}),
 };
}

// Wall of Fire-style rules: a wall that also lists a ring radius can be cast either way.
export function allowsWallRing(rule){
 return rule?.shape==='wall'&&Number(rule.radius)>0;
}
export function formRule(rule,form){
 if(!rule)return rule;
 if(form==='ring'&&allowsWallRing(rule))return {...rule,shape:'ring'};
 return rule;
}
