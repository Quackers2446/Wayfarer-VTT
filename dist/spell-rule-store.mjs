import {ruleProblems,ruleKey,validRuleSet} from './spell-rule-schema.mjs';
const storageKey='wayfarer-spell-rules-v1';let context;
export function loadSpellRules(){try{const rules=JSON.parse(localStorage.getItem(storageKey)||'{}');return validRuleSet(rules)?rules:{};}catch{return {};}}
export function saveSpellRule(rule){const problems=ruleProblems(rule);if(problems.length)throw Error(problems.join(' '));const rules=loadSpellRules();rules[rule.reference]={...structuredClone(rule),revision:crypto.randomUUID(),updatedAt:Date.now()};if(!validRuleSet(rules))throw Error('The spell rule library is full.');localStorage.setItem(storageKey,JSON.stringify(rules));globalThis.document?.dispatchEvent(new Event('wayfarer:library-saved'));return rules[rule.reference];}
export function removeSpellRule(id){const rules=loadSpellRules();delete rules[id];localStorage.setItem(storageKey,JSON.stringify(rules));globalThis.document?.dispatchEvent(new Event('wayfarer:library-saved'));}
export function importSpellRules(value){if(!validRuleSet(value))throw Error('This file contains invalid spell rules.');const merged={...loadSpellRules(),...value};if(!validRuleSet(merged))throw Error('The spell rule library is full.');localStorage.setItem(storageKey,JSON.stringify(merged));globalThis.document?.dispatchEvent(new Event('wayfarer:library-saved'));}
export function setSpellRuleContext(rules){context=rules;}
export function customSpellRule(key,rules=context??loadSpellRules()){
 const id=String(key).toLowerCase(),rule=rules?.[id] ?? (!id.includes('|')?Object.values(rules??{}).find(rule=>rule.edition==='2014'&&ruleKey(rule.name)===ruleKey(id)):null);
 return rule?.enabled && !ruleProblems(rule).length?rule:null;
}
export function customSpellEffect(key,rules){const definition=customSpellRule(key,rules);if(!definition)return;return {custom:true,definition,level:definition.level,range:definition.range,self:definition.shape==='self',area:!['target','self'].includes(definition.shape)?Math.max(1,definition.radius):undefined,bonus:definition.timing==='bonus',exploration:true};}
