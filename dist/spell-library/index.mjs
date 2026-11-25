// Built-in spell rules, shipped with the app.  They are *not* stored in rooms or localStorage: castCustomSpell looks them up
// here whenever a spell has no user-made rule, and a user rule for the same spell always wins (see spell-rule-store.mjs).
// To add spells, put them in a batch file; do not edit this index.
import {migrated} from './migrated.mjs';
import {exemplars} from './exemplars.mjs';
import {batch as cantrips} from './batch-cantrips.mjs';
import {batch as level1} from './batch-level1.mjs';
import {batch as level2} from './batch-level2.mjs';
import {batch as level3} from './batch-level3.mjs';
import {batch as level4} from './batch-level4.mjs';
import {batch as level5to9} from './batch-level5-9.mjs';
import {batch as gaps} from './batch-gaps.mjs';
import {batch as xge} from './batch-xge.mjs';
import {ruleKey} from '../spell-rule-schema.mjs';

export const builtinFiles = {migrated, exemplars, cantrips, level1, level2, level3, level4, 'level5-9': level5to9, gaps, xge};
const rules = {}, names = {};
for (const [file, list] of Object.entries(builtinFiles)) {
  for (const rule of list) {
    if (rules[rule.reference]) throw Error('Duplicate built-in spell ' + rule.reference + ' in ' + file + '.');
    rules[rule.reference] = Object.freeze(rule);
    names[ruleKey(rule.name)] ??= rule;
  }
}

// { 'phb|fire bolt': rule, ... }  Rules are frozen; the engine and editor clone before changing anything.
export const builtinRules = Object.freeze(rules);
export const builtinRule = reference => rules[reference];
// Lookup by spell name for callers that only know the name (native spell keys such as 'fire bolt').
export const builtinRuleByName = name => names[ruleKey(name)];
export const builtinList = () => Object.values(rules);
