# Spell engine v2

Wayfarer casts combat spells from **data rules**, not hand-written JS, whenever a rule exists. This document is the source of truth for authoring built-ins (Phase 2) and for the spell editor UI (Phase 3).

## Lookup order

1. User override in the room (`battle.spellRules`) or localStorage (`wayfarer-spell-rules-v1`) — only if `enabled` and valid.
2. Built-in library (`dist/spell-library/`, keyed by `phb|spell name`).
3. Legacy Wall of Fire starter (migration path).

Built-ins are **never** copied into rooms or localStorage (size + the 200-rule cap). User overrides always win while enabled; a disabled override falls through to the built-in.

Entry points: `customSpellRule` / `customSpellEffect` in `dist/spell-rule-store.mjs`, `supportedSpell` / `castSpell` in `dist/combat.mjs`.

## Files

| File | Role |
|------|------|
| `dist/spell-rule-schema.mjs` | Validation (`ruleProblems`), v1→v2 `migrateRule`, `starterRule` |
| `dist/spell-library/builders.mjs` | Helpers: `spell`, `dmg`, `damage`, `healing`, `status`, `condition`, … |
| `dist/spell-library/exemplars.mjs` | One exemplar per primitive (copy these) |
| `dist/spell-library/migrated.mjs` | Former natives expressed as data (Fire Bolt, Magic Missile, …) |
| `dist/spell-library/batch-*.mjs` | Phase 2 batches (PHB/TCE by level, plus `batch-xge.mjs`) |
| `dist/spell-library/index.mjs` | Merges batches into `builtinRules` |
| `dist/conditions.mjs` | Condition table + status model (`modsOf`) |
| `dist/custom-spells.mjs` | Data-driven cast / zones / spheres |
| `dist/reactions.mjs` | Armed reaction spells (Shield, Absorb Elements, Hellish Rebuke) |
| `dist/summons.mjs` | Spiritual Weapon–style summons |
| `dist/forced-movement.mjs` | Push / pull |
| `dist/spell-shapes.mjs` / `spell-scaling.mjs` | Geometry + upcast math |
| `scripts/spell-test-kit.mjs` | Headless cast helpers |
| `scripts/test-spell-engine.mjs` | Regression for every exemplar |

## Writing a built-in spell

1. Pick the closest exemplar in `exemplars.mjs`.
2. Add a rule to the right batch file (`batch-cantrips.mjs`, `batch-level1.mjs`, …) using `spell(...)` from `builders.mjs`.
3. `reference` is always `phb|<ruleKey(name)>` (lowercase, no apostrophes). TCE spells use `tce|…`; XGE spells use `xge|…`.
4. Run `node scripts/test-spell-engine.mjs` and add a short case with `setup('phb|your spell')` from `spell-test-kit.mjs`.
5. Do **not** put functions, classes, or closures on the rule or on battle state — rooms JSON-sync through the worker.

### Minimal example

```js
import {spell, dmg, damage} from './builders.mjs';

export const batch = [
  spell('Chromatic Orb', 1, {
    range: 90, attack: 'ranged',
    effects: [damage(dmg('3d8', 'fire', {upcast: '1d8'}))],
  }),
];
```

## Rule fields (v2)

Top-level keys (unknown keys fail validation):

`version` (must be `2`), `name`, `reference`, `source`, `edition` (`2014`/`2024`), `level` (0–9), `enabled`, `timing` (`action`/`bonus`/`reaction`), `reactionTrigger`, `reactionDamageTypes`, `range`, `sight`, `hearing`, `shape`, `radius`, `side`, `length`, `width`, `origin`, `targets`, `attack` (`''`/`ranged`/`melee`), `concentration`, `duration` (seconds), `scale`, `persistent`, `endNextTurn`, `difficult`, `blocksVision`, `blocksRanged`, `blocksMovement`, `nearby`, `move`, `transfer`, `effects`, `visual`, `importNotes`, `nativeKey`, `notes`.

### Shapes

| Shape | Targeting UI | Notes |
|-------|--------------|-------|
| `creature` | Pick creature(s) | Use `targets` for multi-target / beams / darts |
| `self` | No pick | Buffs / reactions on the caster |
| `point` | Empty square | Teleport destination, summons |
| `circle` | Point + radius | Fireball, Moonbeam |
| `cube` | Point or caster origin | Thunderwave (`origin:'caster'`), Faerie Fire |
| `cone` | Direction from caster | Burning Hands (`length`) |
| `line` | Direction | Lightning Bolt (`length`, `width`) |
| `wall` | Two points | Wall of Fire (legacy `line` migrates here) |
| `ring` | Point + radius | Ring walls |
| `aura` | Follows caster | Spirit Guardians (`persistent` required) |
| `movable` | Place + bonus move | Flaming Sphere (`persistent`, `move`) |

### Targets (creature shape)

```js
targets: {base: 3, perSlot: 1, perTier: 0, repeat: true, sharedRoll: false, side: 'enemy', types: ['humanoid'], exclude: [], maxHp: null, self: false}
```

- `repeat: true` → Scorching Ray / Eldritch Blast (one attack or dart per count, may split).
- `sharedRoll: true` → Magic Missile (one roll, applied N times).
- `perTier` → cantrip beam growth at levels 5 / 11 / 17.
- `side`: `any` / `ally` / `enemy` / `other`.
- `transfer: true` on the rule → Hex / Hunter's Mark can move to a new target for a bonus action with no slot when the mark drops.

### Effect blocks

Kinds: `damage`, `healing`, `effect`, `teleport`, `summon`, `dispel`.

Triggers: `cast`, `enter`, `start`, `end`, `ram`, `step` (per 5 ft of movement through a zone).

Common fields: `save`, `onSave` (`half`/`none`), `condition`, `repeatSave` (`start`/`end`/`damaged`), `escape: {ability}`, `status`, `push: {mode:'away'|'toward', distance, maxSize}`, `tempHp`, `excludeTypes`, `affects` (`all`/`enemies`/`allies`/`others`), `to` (`targets`/`self`/`source`).

### Status model

Anything that changes numbers for a while is an entry in `actor.conditions` with optional `mods` / `rollModifiers`. Table conditions (`Restrained`, `Hasted`, …) live in `dist/conditions.mjs` `conditionTable`. Spell statuses (Bless, Mage Armor, Shield, Hex) use the same list.

Useful `status` fields: `acBonus`, `acBase: {base, dex}`, `speedBonus`, `speedMultiplier`, `attack`/`attackedBy`/`check` (`adv`/`dis`), `save` / `saveBonus`, `rollModifiers`, `resist`/`immune`/`vulnerable` (damage types; `'triggering'` for Absorb Elements), `blockMagicMissile` (2014 Shield), `riders` (extra damage on your hits), `markRiders` (extra damage when you hit this marked creature), `until` (`casterStart`/`casterEnd`/`targetStart`/`targetEnd`), `ends: {onAttacked, onAttack, onDamaged}`.

`reactionTrigger` may be a single value or an array (Shield uses `['hit','magicMissile']`).

### Reactions

Arm with `armReaction(actor, 'phb|shield')`, or toggle reaction spells from the hotbar Passives tab / class controls. Triggers:

| Trigger | When | Exemplar |
|---------|------|----------|
| `hit` | Attack roll would hit (before damage) | Shield |
| `damage` | About to take damage | Absorb Elements |
| `damaged` | After taking damage | Hellish Rebuke |
| `falling` | Falling damage | Feather Fall (not yet) |
| `spellCast` | Another creature casts | Counterspell |
| `magicMissile` | Targeted by Magic Missile | Shield (also `hit`) |

## Primitive → exemplar table

| Primitive | Exemplar |
|-----------|----------|
| Multi-target buff / debuff + concentration | Bless, Bane |
| AC bonus / AC base | Shield of Faith, Mage Armor |
| Haste / Slow statuses | Haste, Slow |
| Reaction AC | Shield |
| Reaction resistance + rider | Absorb Elements |
| Reaction damage to attacker | Hellish Rebuke |
| Cube from caster + push | Thunderwave |
| Line | Lightning Bolt |
| Cube status (adv against) | Faerie Fire |
| Multi-attack rays | Scorching Ray |
| Next-attack advantage rider | Guiding Bolt |
| Mark + transfer | Hex, Hunter's Mark |
| Summon | Spiritual Weapon |
| Zone step damage | Spike Growth |
| Zone enter / start | Moonbeam |
| Aura following caster | Spirit Guardians |
| Restrained + escape | Web |
| Dispel | Dispel Magic |
| HP-pool sleep | Sleep (`kind:'sleep'`, `sleepPool`) |
| Forced flee on failed save | Dissonant Whispers (`flee:true`) |
| Temp HP + retaliation | False Life, Armor of Agathys (`tempHp`, `retaliation`) |
| Max-HP bump | Aid (`maxHpBonus` + `maxHpBonusPerSlot`) |
| Vision zones | Fog Cloud, Darkness (`blocksVision`, `zoneName`) |
| Ranged deflection | Wind Wall (`blocksRanged`) |
| Solid walls | Wall of Ice (`blocksMovement` + `blocksRanged` + `blocksVision`) |
| Wall beam follow-up | Wall of Light (`trigger:'beam'` + hotbar Beam action) |
| Concentration tether | Witch Bolt (`tether`) |
| Delayed / lingering damage | Melf's Acid Arrow (`pendingDamage`) |
| Heal from damage dealt | Vampiric Touch (`healFraction`) |
| Counterspell | Counterspell (`reactionTrigger:'spellCast'`; failed checks still spend the slot/reaction) |
| Mirror Image | Mirror Image (`images` on status) |
| Weapon cantrips | Booming Blade / Green-Flame Blade (`weaponAttack`) |
| Grant exhalation | Dragon's Breath (`exhale` on status) |
| Teleport (bonus) | Misty Step |
| Migrated cantrips / heals | Fire Bolt, Eldritch Blast, Magic Missile, Cure Wounds, Healing Word, Burning Hands, … |

## Test kit

```js
import {setup, fixed, natural, sequence, nextRound, passUntil, hasStatus, map} from './spell-test-kit.mjs';

const s = setup('phb|bless', {allies: [{}]});
s.cast(s.byId.ally);
assert(hasStatus(s.byId.ally, 'Bless'));
```

- Dice: `fixed(.45)` → dN shows about the middle face (d6→3, d8→4, d10→5). Prefer exact expected totals over “≥”.
- Place allies within range (touch spells need `x`/`y` within 5 ft of the caster at `2,10`).
- `setup` starts initiative by default; `kit.fresh()` clears action / bonus / reaction for the next cast.

## Still deferred

Built-ins in `batch-gaps.mjs` now cover the former native gaps above. Remaining hard cases:

| Spell / feature | Gap |
|-----------------|-----|
| Hold Person / Charm Person cluster | Multi-target “within 30 ft of each other” UI (filters exist; clustering soft) |
| Invisibility break-on-attack | Prefer `ends.onAttack` / `breakInvisibility` wiring audit |
| Searing / Thunderous / Wrathful Smite | Bonus riders exist; prone/frighten-on-hit extras vary |
| Conjure Animals / Elemental / Find Familiar | Richer summons than Spiritual Weapon |
| Heat Metal / Phantasmal Force | Sustained save loops with player choices |
| Green-Flame Blade splash | Second-target fire damage within 5 ft |
| Booming Blade move trigger | Extra thunder if the target moves before its next turn |
| Ice Knife cold splash | 5-ft Dex burst after the knife hit |
| Chaos Bolt type / bounce | Random damage type and same-number bounce |
| Toll the Dead branching | Always uses the larger die today |
| Thunder Step departure blast | Teleport ships; 10-ft thunder at origin deferred |
| Melf's Minute Meteors volley | Simplified to a concentration fire rider |
| Feather Fall | `falling` reaction not wired yet |
| Sacred Flame ignores cover | Cover flag on save spells |
| XGE summons / rituals | Summon Lesser/Greater Demon, Find Greater Steed, Ceremony, … |

Native definitions remain as a fallback for Foundry imports that set `nativeKey`. Casting prefers built-in data when present.

## Phase 2 checklist (spell batches)

1. Read this doc + copy an exemplar; do not invent new schema fields without updating `ruleProblems` and this file.
2. Prefer PHB + TCE + XGE 2014 combat spells levels 0–5 (inventory hint: `wayfarer/.spell-combat-inventory.json`). Skip pure utility (Alarm, Identify, Message, Control Flames, …) unless trivial. XGE combat entries live in `batch-xge.mjs`.
3. One batch file ownership: cantrips / L1 / L2–3 / L4–6 — no overlapping references.
4. Every new rule must pass `ruleProblems(rule) === []` and have at least one kit assertion.
5. Animations: matched by name via `dist/spell-animation-library.mjs`; no need to set `visual` unless overriding.
6. Leave editor UI to Phase 3; do not redesign `spell-rule-editor.mjs` here.

## Phase 3 notes (editor)

The current editor still speaks a mix of v1 field names (`shape:'target'`, boolean `attack`). It must be rebuilt against v2 shapes, status blocks, reactions, and the built-in library browser (`builtinList()`). Keep draft/save/publish/test encounter flows.
