import {
  turnView, canTakeTurn, actorIsUp, addCondition, addInspiration, advanceTime, canSee, condition, currentActor, d20, distanceFt, hasFeature, heal, incapacitated,
  log, occupies, rollDice, savingThrow, speedOf, applyDamage,
} from "./combat.mjs";
import {captureImpact, recordAction, withActionEvent} from "./action-events.mjs";
import {pactMagicResource} from "./class-features.mjs";

export function migratePactResources(actor) {
  if(!actor.classRules?.pact || actor.resources?.pactMagic) return;
  const pool=pactMagicResource(actor.classRules.levels?.Warlock,actor.classRules.edition);
  if(!pool) return;
  const onlyPact=Object.keys(actor.classRules.levels).every(name=>name==="Warlock");
  const remaining=onlyPact ? actor.slots?.[pool.slotLevel]?.current : undefined;
  (actor.resources ??= {}).pactMagic={...pool,current:Math.min(pool.maximum,remaining ?? pool.maximum)};
  if(onlyPact) actor.slots={};
}

export function classWeapons(actor,battle) {
  battle=turnView(battle,actor);
  const attacks = [...actor.attacks];
  if (actor.astralArms && hasFeature(actor,"Arms of the Astral Self")) {
    const wisdom = actor.ability.wis ?? 0;
    attacks.push({name:"Astral Arms",bonus:wisdom+(actor.proficiency ?? 0),
      damage:(actor.classRules.unarmoredMonk ? "1d"+actor.classRules.martialDie : "1")+(wisdom >= 0 ? "+" : "")+wisdom,type:"force",
      reach:currentActor(battle)?.id === actor.id ? 10 : 5,unarmed:true,monkWeapon:true});
    const ordinary=Math.max(actor.ability.str ?? 0,actor.classRules.unarmoredMonk ? actor.ability.dex ?? 0 : -Infinity);
    if(ordinary>wisdom) attacks.push({...attacks.at(-1),name:"Astral Arms (physical ability)",bonus:ordinary+(actor.proficiency ?? 0),
      damage:(actor.classRules.unarmoredMonk ? "1d"+actor.classRules.martialDie : "1")+(ordinary>=0 ? "+" : "")+ordinary});
  }
  return attacks;
}

export function syncClassResources(actor,source) {
  actor.classRules = source.classRules;
  actor.proficiency = source.proficiency;
  actor.skillBonuses = source.skillBonuses;
  actor.proficientSkills = source.proficientSkills;
  const previousResources = actor.resources ?? {};
  actor.resources = {};
  for (const [key,pool] of Object.entries(source.resources ?? {})) {
    const legacyPact=key==="pactMagic" && Object.keys(source.classRules?.levels ?? {}).every(name=>name==="Warlock") && !previousResources.pactMagic;
    const current = previousResources[key]?.current ?? (legacyPact ? actor.slots?.[pool.slotLevel]?.current : undefined) ?? pool.current;
    actor.resources[key] = {...pool,current:Math.min(current,pool.maximum)};
    if(legacyPact && actor.slots) for(const rank of Object.keys(actor.slots)) if(!(source.slots?.[rank]?.maximum>0)) delete actor.slots[rank];
  }
  actor.swings = Math.max(1,source.classRules?.swings ?? actor.swings);
  for (const attack of source.attacks.filter((entry) => entry.unarmed)) {
    const existing = actor.attacks.find((entry) => entry.name === attack.name);
    if (!existing) actor.attacks.push(attack);
    else Object.assign(existing,{unarmed:true,monkWeapon:true,type:existing.type ?? attack.type});
  }
}

const definitions = [
  {id:"cunning-dash",name:"Cunning Action · Dash",feature:"Cunning Action",timing:"bonus"},
  {id:"cunning-disengage",name:"Cunning Action · Disengage",feature:"Cunning Action",timing:"bonus"},
  {id:"cunning-hide",name:"Cunning Action · Hide",feature:"Cunning Action",timing:"bonus"},
  {id:"martial-arts",name:"Martial Arts · bonus strike",feature:"Martial Arts",timing:"bonus",attack:true},
  {id:"flurry",name:"Flurry of Blows",feature:"Flurry of Blows",timing:"bonus",resource:"ki",cost:1},
  {id:"flurry-strike",name:"Flurry · unarmed strike",feature:"Flurry of Blows",timing:"flurry",attack:true},
  {id:"ki-fueled",name:"Ki-Fueled Attack",feature:"Ki-Fueled Attack",timing:"bonus",attack:true,monkWeapon:true},
  {id:"quickened-healing",name:"Quickened Healing",feature:"Quickened Healing",timing:"action",resource:"ki",cost:2},
  {id:"patient-defense",name:"Patient Defense",feature:"Patient Defense",timing:"bonus",resource:"ki",cost:1},
  {id:"step-dash",name:"Step of the Wind · Dash",feature:"Step of the Wind",timing:"bonus",resource:"ki",cost:1},
  {id:"step-disengage",name:"Step of the Wind · Disengage",feature:"Step of the Wind",timing:"bonus",resource:"ki",cost:1},
  {id:"astral-arms",name:"Summon Astral Arms",feature:"Arms of the Astral Self",timing:"bonus",resource:"ki",cost:1,area:10},
  {id:"astral-visage",name:"Summon Astral Visage",feature:"Visage of the Astral Self",timing:"bonus",resource:"ki",cost:1},
  {id:"astral-both",name:"Summon Astral Arms and Visage",feature:"Visage of the Astral Self",timing:"bonus",resource:"ki",cost:2,area:10},
  {id:"stillness",name:"Stillness of Mind",feature:"Stillness of Mind",timing:"action"},
  {id:"second-wind",name:"Second Wind",feature:"Second Wind",timing:"bonus",resource:"secondWind",cost:1},
  {id:"action-surge",name:"Action Surge",feature:"Action Surge",timing:"free",resource:"actionSurge",cost:1},
  {id:"inspire",name:"Bardic Inspiration",feature:"Bardic Inspiration",timing:"bonus",resource:"inspiration",cost:1,target:"ally"},
  {id:"master-help",name:"Master of Tactics · Help",feature:"Master of Tactics",timing:"bonus",target:"enemy"},
  {id:"steady-aim",name:"Steady Aim",feature:"Steady Aim",timing:"bonus"},
  {id:"bladesong",name:"Bladesong",feature:"Bladesong",timing:"bonus",resource:"bladesong",cost:1},
];

export function classActions(actor,battle) {
  battle=turnView(battle,actor);
  return definitions.filter((entry) => hasFeature(actor,entry.feature) &&
    (entry.id !== "martial-arts" || actor.classRules.unarmoredMonk) &&
    (entry.id !== "flurry-strike" || battle.flurry > 0)).map(entry=>({...entry,
      cost:entry.id === "astral-both" ? (actor.classRules?.featureCosts?.["Arms of the Astral Self"]?.cost ?? 1)+(actor.classRules?.featureCosts?.["Visage of the Astral Self"]?.cost ?? 1) :
        actor.classRules?.featureCosts?.[entry.feature]?.cost ?? entry.cost}));
}

function requireAction(battle,actor,definition) {
  if (!canTakeTurn(battle,actor) || !actorIsUp(actor) || incapacitated(actor)) {
    throw new Error("Use this ability on this character’s turn.");
  }
  if (battle.movement || battle.classReaction) throw new Error("Resolve the pending reaction first.");
  if (definition.timing === "action" && battle.action) throw new Error("This character has used their action.");
  if (definition.timing === "bonus" && battle.bonusUsed) throw new Error("This character has used their bonus action.");
  if (definition.resource && !(actor.resources?.[definition.resource]?.current >= definition.cost)) {
    throw new Error("Not enough "+(actor.resources?.[definition.resource]?.name ?? definition.resource)+" remaining.");
  }
}

function hide(battle,actor,map,random) {
  const threats = battle.actors.filter((enemy) => enemy.side === "hostile" && actorIsUp(enemy) && occupies(enemy));
  if (threats.some((enemy) => canSee(battle,enemy,actor,map))) throw new Error("Move out of enemy sight before hiding.");
  const bonus = actor.skillBonuses?.stealth ?? actor.ability.dex ?? 0;
  const result = d20(bonus,{random});
  if (hasFeature(actor,"Reliable Talent") && actor.proficientSkills?.includes("stealth") && result.kept < 10) {
    result.total += 10-result.kept;
  }
  addCondition(battle,actor,"Hidden",3600,{stealth:result.total});
  log(battle,actor.name+" hides with a Stealth check of "+result.total+".");
}

export function useClassAction(battle,actor,id,options = {},random = Math.random) {
  battle=turnView(battle,actor);
  const definition = classActions(actor,battle).find((entry) => entry.id === id);
  return withActionEvent(battle,actor,{action:definition?.name ?? id,kind:"ability",target:options.target?.name},
    () => resolveClassAction(battle,actor,id,options,random));
}

function resolveClassAction(battle,actor,id,options,random) {
  const definition = classActions(actor,battle).find((entry) => entry.id === id);
  if (!definition) throw new Error("This character does not have that feature.");
  requireAction(battle,actor,definition);
  if (definition.attack) throw new Error("Choose a target for the unarmed strike.");
  const target = options.target;
  if (id === "flurry" && !battle.attacksMade) throw new Error("Take the Attack action first.");
  if (id === "steady-aim" && battle.spent) throw new Error("Steady Aim requires that you have not moved this turn.");
  if (id === "action-surge" && battle.actionSurged) throw new Error("Action Surge is already used this turn.");
  if (id === "bladesong" && actor.classRules.bladesongAllowed === false) throw new Error("Bladesong requires light armor or no armor and no shield.");
  if (id === "inspire" && (!target || target.id === actor.id || target.side !== actor.side || !actorIsUp(target) ||
      distanceFt(actor,target) > 60 || condition(target,"Deafened") || target.inspiration)) {
    throw new Error("Choose an ally within 60 ft who can hear you and has no Bardic Inspiration die.");
  }
  if (id === "master-help" && (!target || target.side === actor.side || !actorIsUp(target) ||
      distanceFt(actor,target) > 30 || !canSee(battle,actor,target,options.map))) {
    throw new Error("Choose a visible enemy within 30 ft.");
  }
  if (id === "stillness" && !condition(actor,"Charmed") && !condition(actor,"Frightened")) {
    throw new Error("This character is neither charmed nor frightened.");
  }
  if (id === "cunning-hide") hide(battle,actor,options.map,random);
  if (definition.resource) actor.resources[definition.resource].current -= definition.cost;
  if (definition.resource === "ki" && definition.timing === "action") battle.kiAction = true;
  if (definition.timing === "action") battle.action = "feature";
  if (definition.timing === "bonus") battle.bonusUsed = true;

  if (id === "cunning-dash" || id === "step-dash") battle.dash += speedOf(actor);
  if (id === "cunning-disengage" || id === "step-disengage") actor.disengaged = true;
  if (id === "patient-defense") actor.dodging = true;
  if (id === "flurry") battle.flurry = 2;
  if (id === "quickened-healing") {
    const roll=rollDice("1d"+actor.classRules.martialDie+"+"+actor.proficiency,{random,label:"Quickened Healing"});
    const restored=heal(actor,roll.total);
    captureImpact(battle,actor,{amount:restored,healing:true});
    log(battle,actor.name+" regains "+restored+" HP with Quickened Healing ("+roll.breakdown+").");
  }
  if (id.startsWith("astral-")) {
    if (id === "astral-arms" || id === "astral-both") {
      actor.astralArms = {expires:(battle.elapsed ?? 0)+600};
      for (const enemy of options.targets ?? []) {
        if (!actorIsUp(enemy) || !occupies(enemy) || enemy.id === actor.id || distanceFt(actor,enemy) > 10 ||
            !canSee(battle,actor,enemy,options.map)) continue;
        const save = savingThrow(enemy,"dex",{random});
        const dc = actor.classRules.kiDC;
        log(battle,enemy.name+" Dexterity save "+save.total+" vs Ki DC "+dc+".");
        if (save.total < dc) {
          const damage = rollDice("2d"+actor.classRules.martialDie,{random});
          const result = applyDamage(battle,enemy,damage.total,"force",false,random,actor);
          captureImpact(battle,enemy,{amount:result.damage,type:"force",defeated:result.defeated});
          log(battle,enemy.name+" takes "+result.damage+" force damage from Astral Arms ("+damage.breakdown+").");
        }
      }
    }
    if (id === "astral-visage" || id === "astral-both") actor.astralVisage = {expires:(battle.elapsed ?? 0)+600};
  }
  if (id === "stillness") actor.conditions = (actor.conditions ?? []).filter((entry) => !["Charmed","Frightened"].includes(entry.name));
  if (id === "second-wind") {
    const restored = heal(actor,rollDice("1d10+"+actor.classRules.levels.Fighter,{random,label:"Second Wind"}).total);
    captureImpact(battle,actor,{amount:restored,healing:true});
    log(battle,actor.name+" regains "+restored+" HP with Second Wind.");
  }
  if (id === "action-surge") {
    battle.action = null;
    battle.attacksMade = 0;
    battle.actionSurged = true;
  }
  if (id === "inspire") target.inspiration = {faces:actor.classRules.inspirationDie,expires:(battle.elapsed ?? 0)+600};
  if (id === "master-help") target.helped = {side:actor.side,helper:actor.id,expiresRound:battle.round+1};
  if (id === "steady-aim") actor.steadyAim = true;
  if (id === "bladesong") actor.bladesong = {expires:(battle.elapsed ?? 0)+60};
  log(battle,actor.name+" uses "+definition.name+(target ? " on "+target.name : "")+".");
}

export function classSkillCheck(battle,actor,name,map,random = Math.random) {
  return withActionEvent(battle,actor,{action:name+" check",kind:"check"},() => resolveSkillCheck(battle,actor,name,map,random));
}

function resolveSkillCheck(battle,actor,name,map,random) {
  if (!actorIsUp(actor) || incapacitated(actor)) throw new Error("This character cannot make this check.");
  let modifier = actor.skillBonuses?.[name];
  if (!Number.isFinite(modifier)) throw new Error("Complete this skill’s modifier on the character sheet.");
  if(name === "athletics" && actor.astralArms) modifier+=Math.max(0,(actor.ability.wis ?? 0)-(actor.ability.str ?? 0));
  const astral = actor.astralVisage && ["insight","intimidation"].includes(name);
  const acrobatics = actor.bladesong && name === "acrobatics";
  const result = d20(modifier,{advantage:Boolean(astral || acrobatics),random,label:name+" check"});
  if (hasFeature(actor,"Reliable Talent") && actor.proficientSkills?.includes(name) && result.kept < 10) {
    result.total += 10-result.kept;
    result.breakdown += " (Reliable Talent minimum 10)";
  }
  addInspiration(actor,result,random);
  log(battle,actor.name+" "+name+" check — "+result.breakdown+" = "+result.total+".");
  return result;
}

export function restParty(battle,long = false) {
  if (battle.round || battle.movement) throw new Error("Finish combat before resting.");
  const heroes = battle.actors.filter((actor) => actor.side === "party" && !actor.dead);
  for (const actor of heroes) {
    recordAction(battle,actor,{action:long ? "Long rest · 8 hours" : "Short rest · 1 hour",kind:"rest"});
    for (const pool of Object.values(actor.resources ?? {})) {
      if (long || pool.rest === "short") pool.current = pool.maximum;
    }
    if (long) {
      heal(actor,actor.maxHp);
      for (const pool of Object.values(actor.slots)) if (Number.isFinite(pool.maximum)) pool.current = pool.maximum;
    } else if (actor.classRules?.pact && !actor.resources?.pactMagic) {
      for (const pool of Object.values(actor.slots)) if (Number.isFinite(pool.maximum)) pool.current = pool.maximum;
    }
    actor.reactionUsed = false;
    delete actor.astralArms;
    delete actor.astralVisage;
    delete actor.bladesong;
  }
  advanceTime(battle,long ? 28800 : 3600);
  log(battle,"The party finishes a "+(long ? "long" : "short")+" rest.");
}
