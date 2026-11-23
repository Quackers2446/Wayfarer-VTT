import {diceTerms, rollDice} from "./combat.mjs";
import {ruleKey} from "./rules-library.mjs";

const creatureTags = /\{@creature\s+([^|}]+)(?:\|([^|}]*))?(?:\|([^}]+))?\}/gi;
const markerTags = /\{@(item|object|trap|hazard)\s+([^|}]+)(?:\|([^|}]*))?(?:\|([^}]+))?\}/gi;
const excludedSection = /development|reinforcement|random|wandering|tactics|roleplaying|award|experience points|background|history|further encounters/i;
const countWords = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ");
const countPattern = new RegExp("\\b(\\d+|" + countWords.join("|") + "|a|an)\\s+(?:[a-z'-]+\\s+){0,2}$", "i");
const conditional = /\b(?:if|unless|once|after|whenever|summons?|reinforcements?|wandering|for example|might|could)\b/i;
const immediate = /\b(?:occup(?:y|ies|ied)|inhabit\w*|confined|rests?|resting|stationed|stand(?:s|ing)? (?:guard|watch)|guard(?:s|ing)? (?:this|the|here|inside)|live[sd]?|lives?|dwell\w*|lurk\w*|lying|sleep\w*|asleep|wait\w*|hidden among|inside|here|in this (?:room|area|cave|chamber)|are animated|contains?|are trapped|held prisoner|imprisoned|has been praying|prays?|arranged|sit(?:s|ting)?|captive\w*)\b/i;
const neutral = /\b(?:prisoners?|captives?|hostages?|commoners?|noncombatants?|chained|friendly|harmless|neutral|unless provoked|unless attacked|doesn['’]t attack unless)\b/i;
const container = /\b(?:satchel|chest|cache|coffer|box|locker|sarcophag\w*|pedestal|cupboard|hidden under|hidden behind|hidden in|buried|stash|shelf|shelves|concealed|stored|lying on|lies on)\b/i;
const carried = /\b(?:wears?|wearing|each carries|carried|has a belt pouch|their pouches|on [a-z]+['’]s person|wields?|armor and weapons)\b/i;

function *sentences(node, mappedIds, headings = []) {
  if (typeof node === "string") {
    for (const text of node.match(/(?:\{@[^}]+\}|[^.!?])+[.!?]?/g) ?? []) yield {text:text.trim(), headings};
  } else if (Array.isArray(node)) {
    for (const entry of node) yield *sentences(entry,mappedIds,headings);
  } else if (node && typeof node === "object") {
    if (mappedIds.has(node.id) || ["table","tableGroup","image","gallery","quote","statblock"].includes(node.type) ||
        excludedSection.test(node.name ?? "")) return;
    const next = node.name ? [...headings,node.name] : headings;
    for (const child of [node.entries,node.entry,node.items]) yield *sentences(child,mappedIds,next);
  }
}

function countBefore(prefix) {
  const dice = prefix.match(/\{@dice\s+([^}|]+)(?:\|[^}]+)?\}\s*$/i)?.[1];
  if (dice && diceTerms(dice)) return {formula:dice};
  const plain = prefix.replace(/\{@(?:b|i)\s+([^}]+)\}/g,"$1").trimEnd()+" ";
  const word = plain.match(countPattern)?.[1]?.toLowerCase();
  if (!word) return {};
  if (/^\d+$/.test(word)) return {count:Number(word)};
  return {count:Math.max(1,countWords.indexOf(word)+1)};
}

function inParentheses(prefix) {
  return prefix.lastIndexOf("(")>prefix.lastIndexOf(")");
}

function creatureSpecs(snippet, title) {
  const {text,headings} = snippet;
  const specs = [];
  const area = headings.join(" ") + " " + title;
  for (const match of text.matchAll(creatureTags)) {
    const [tag,name,source,display] = match;
    const before = text.slice(0,match.index);
    const after = text.slice(match.index+tag.length);
    const description = before.slice(-95) + " " + after.slice(0,190);
    if (inParentheses(before) || conditional.test(before) || /^\s*(?:from|in|at)\s+(?:\{@area|(?:area|room)\s+[A-Z]?\d)/i.test(after)) continue;
    const amount = countBefore(before);
    const named = /^[A-Z]/.test(name) && Boolean(source) && !["MM","XMM"].includes(source);
    const local = immediate.test(description);
    if (!local || (!amount.count && !amount.formula && (!named || before.length>60 || /\{@creature/.test(before)))) continue;
    const placement = before.slice(-65) + " " + after.split(/\b(?:though|but|while)\b/i)[0].slice(0,145);
    const disarmed = /\b(?:bound|chained|unarmed|imprisoned|prisoner|captive)\b/i.test(placement);
    specs.push({
      name,source:source || "MM",count:amount.count ?? 1,formula:amount.formula,
      side:neutral.test(placement) || neutral.test(display ?? name) || /\b(?:prisoners|captives)\b/i.test(area) ? "neutral" : undefined,
      named,disarmed,perPolygon:/\beach (?:of these|of the|room)\b/i.test(description),detail:text,
      nickname:named && display && !amount.formula && (amount.count ?? 1)===1 ? display : undefined,
    });
  }
  return specs;
}

function markerSpecs(snippet) {
  const {text,headings} = snippet;
  const markers = [];
  for (const match of text.matchAll(markerTags)) {
    const [tag,kind,name,,display] = match;
    const before = text.slice(0,match.index);
    const after = text.slice(match.index+tag.length);
    if (/\b(?:see|in|at|from)\s+(?:the\s+)?(?:area\s+\w+|\{@area)\b/i.test(before) ||
        /^\s*(?:in|at|from)\s+(?:area\s+|\{@area)/i.test(after)) continue;
    const treasureSection = headings.some((entry) => /treasure|loot/i.test(entry));
    if (kind==="item" && (carried.test(text) || (!container.test(text) && !treasureSection))) continue;
    if (kind !== "item" && !/\b(?:in this room|here|contains?|trap|hazard|room|floor|door|fil(?:l|led)|coats?|cover\w*|stands?|lurks?|locked|sits?|hidden|attack\w*|animatronic|statue|mounted|bolted|set into)\b/i.test(text)) continue;
    const type = kind==="item" ? "treasure" : kind;
    const hidden = type==="trap" || /\b(?:hidden|concealed|secret|locked|buried|search)\b/i.test(text+" "+headings.join(" "));
    const quantity=countBefore(before).count ?? 1;
    markers.push({type,name:display || name,detail:text,hidden,...(kind==='item'?{items:[{name:display || name,reference:(match[3] || 'DMG').toLowerCase()+'|'+name.toLowerCase(),quantity}]}:{})});
  }
  return markers;
}

export function automaticRoom(region, mappedIds) {
  const creatures = new Map();
  const markers = new Map();
  for (const snippet of sentences(region.entry?.entries,mappedIds)) {
    for (const spec of creatureSpecs(snippet,region.entry?.name ?? "")) {
      const key = ruleKey(spec.name)+"|"+spec.source.toLowerCase();
      const previous = creatures.get(key);
      if (!previous || spec.count>previous.count) creatures.set(key,spec);
    }
    const treasureSection=snippet.headings.some(heading=>/treasure|loot/i.test(heading));
    if(treasureSection && !carried.test(snippet.text) && !conditional.test(snippet.text)){
      const currency={};for(const match of snippet.text.matchAll(/([\d,]+)\s*(cp|sp|ep|gp|pp)\b/gi)){
        const prefix=snippet.text.slice(Math.max(0,match.index-30),match.index);if(/worth|valued|value|sell|cost|price/i.test(prefix))continue;
        const unit=match[2].toLowerCase();currency[unit]=(currency[unit]??0)+Number(match[1].replaceAll(',',''));
      }
      if(Object.keys(currency).length){const key='coins|'+snippet.text;markers.set(key,{type:'treasure',name:'Coins',detail:snippet.text,items:[],lootCurrency:currency,hidden:/hidden|concealed|locked|buried/i.test(snippet.text)});}
    }
    if(treasureSection && !carried.test(snippet.text) && !conditional.test(snippet.text) && !/\{@item/.test(snippet.text)){
      const valuables=[];
      for(const match of snippet.text.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+((?:(?:small|large|silver|gold|golden|jeweled|carved|ivory|jade)\s+){0,3}(?:gemstones?|gems?|pearls?|diamonds?|emeralds?|sapphires?|rubies|rings?|necklaces?|bracelets?|combs?|art objects?))\b/gi)){
        const amount=match[1].toLowerCase(),quantity=Number(amount)||Math.max(1,countWords.indexOf(amount)+1);valuables.push({name:match[2],quantity,notes:snippet.text});
      }
      if(valuables.length)markers.set('valuables|'+snippet.text,{type:'treasure',name:'Valuables',detail:snippet.text,items:valuables,hidden:/hidden|concealed|locked|buried/i.test(snippet.text)});
    }
    for (const marker of markerSpecs(snippet)) {
      const key = marker.type+"|"+ruleKey(marker.name);
      const previous = markers.get(key);
      markers.set(key,previous ? {...previous, detail:previous.detail.includes(marker.detail)
        ? previous.detail : previous.detail+" "+marker.detail, hidden:previous.hidden || marker.hidden} : marker);
    }
  }
  return {creatures:[...creatures.values()],markers:[...markers.values()]};
}

export function startingCount(record, random) {
  const amount = record.formula ? rollDice(record.formula,{random}).total : record.count;
  return Number.isInteger(amount) && amount>0 && amount<=60 ? amount : 0;
}
