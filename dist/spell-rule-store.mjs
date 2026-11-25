import {ruleProblems,ruleKey,validRuleSet,starterRule,migrateRule,spellShapes} from './spell-rule-schema.mjs';
import {nativeSpellDefinitions} from './native-spell-definitions.mjs';
import {builtinRule,builtinRuleByName} from './spell-library/index.mjs';
const storageKey='wayfarer-spell-rules-v1';let context;
const wallOfFire = migrateRule(starterRule({name:'Wall of Fire',source:'PHB',edition:'2014',level:4}));
export function loadSpellRules(){try{const rules=JSON.parse(localStorage.getItem(storageKey)||'{}');return validRuleSet(rules)?rules:{};}catch{return {};}}
export function saveSpellRule(rule){const problems=ruleProblems(rule);if(problems.length)throw Error(problems.join(' '));const rules=loadSpellRules();rules[rule.reference]={...structuredClone(rule),revision:crypto.randomUUID(),updatedAt:Date.now()};if(!validRuleSet(rules))throw Error('The spell rule library is full.');localStorage.setItem(storageKey,JSON.stringify(rules));globalThis.document?.dispatchEvent(new Event('wayfarer:library-saved'));return rules[rule.reference];}
export function removeSpellRule(id){const rules=loadSpellRules();delete rules[id];localStorage.setItem(storageKey,JSON.stringify(rules));globalThis.document?.dispatchEvent(new Event('wayfarer:library-saved'));}
export function importSpellRules(value){if(!validRuleSet(value))throw Error('This file contains invalid spell rules.');const merged={...loadSpellRules(),...value};if(!validRuleSet(merged))throw Error('The spell rule library is full.');localStorage.setItem(storageKey,JSON.stringify(merged));globalThis.document?.dispatchEvent(new Event('wayfarer:library-saved'));}
export function setSpellRuleContext(rules){context=rules;}
// Lookup order: the user's enabled override (localStorage or room snapshot), then the built-in library, then Wall of Fire's legacy starter.
// Built-ins are never copied into rooms or localStorage.  The result is always a v2 rule (v1 rules are migrated on the fly).
export function customSpellRule(key,rules=context??loadSpellRules()){
 const id=String(key).toLowerCase(),rule=rules?.[id] ?? (!id.includes('|')?Object.values(rules??{}).find(rule=>rule.edition==='2014'&&ruleKey(rule.name)===ruleKey(id)):null);
 if(rule?.enabled && !ruleProblems(rule).length)return migrateRule(rule);
 // Prefer an exact source|name hit, then any built-in with the same spell name (sheet books often differ from the automation source).
 const builtin=(id.includes('|')?builtinRule(id):null)??builtinRuleByName(id.includes('|')?id.split('|').at(-1):id);
 if(builtin?.enabled)return builtin;
 return id===wallOfFire.reference||id==="wall of fire"?wallOfFire:null;
}
export const customSpellShapes=spellShapes;
export function customSpellEffect(key,rules){
 const definition=customSpellRule(key,rules);if(!definition)return;
 if(definition.nativeKey)return {...nativeSpellDefinitions[definition.nativeKey],importedNative:true,nativeKey:definition.nativeKey,definition};
 const aimed=!['creature','self','aura'].includes(definition.shape);
 return {custom:true,definition,level:definition.level,range:definition.range,self:['self','aura'].includes(definition.shape),
  area:aimed?Math.max(1,definition.radius??definition.length??definition.side??1):undefined,bonus:definition.timing==='bonus',reaction:definition.timing==='reaction',exploration:true,filter:definition.targets};
}
// The editor's starting point for a spell: an existing built-in rule if there is one, otherwise the legacy starter.
export function starterRuleFor(spell){
 const id=(spell.source??'PHB').toLowerCase()+'|'+ruleKey(spell.name),builtin=builtinRule(id);
 return builtin?structuredClone(builtin):starterRule(spell);
}
