export function isChatCommand(text) {
  return /^\s*\//.test(text);
}

export function parseRollCommand(raw) {
  const match = raw.trim().match(/^\/(?:roll|r)\b\s*(.*)$/i);
  if (!match) return null;
  let text = match[1].trim();
  if (!text) {
    return {
      error: "Enter a dice expression to roll, e.g. /roll d20, /roll d20 + 3d6 + d7, /roll d20a (advantage), or /roll d20d (disadvantage)"
    };
  }

  let advantage = false;
  let disadvantage = false;

  // Replace / detect words "advantage", "adv", "disadvantage", "dis"
  if (/\b(?:advantage|adv)\b/i.test(text)) {
    advantage = true;
    text = text.replace(/\b(?:advantage|adv)\b/gi, " ").trim();
  }
  if (/\b(?:disadvantage|dis)\b/i.test(text)) {
    disadvantage = true;
    text = text.replace(/\b(?:disadvantage|dis)\b/gi, " ").trim();
  }

  // Handle d20a or d20d shorthand (e.g. d20a, 1d20a, 2d20a, d20d, 1d20d)
  text = text.replace(/(\d*)d20([ad])\b/gi, (_, count, flag) => {
    if (flag.toLowerCase() === "a") advantage = true;
    if (flag.toLowerCase() === "d") disadvantage = true;
    return (count || "1") + "d20";
  });

  // Split dice formula from optional trailing label
  const regex = /^\s*([+-]?\s*(?:\d*d\d+(?:k[hl]\d+)?|\d+)(?:\s*[+\-*\/]\s*(?:\d*d\d+(?:k[hl]\d+)?|\d+))*)/i;
  const m = text.match(regex);
  let diceFormula = "";
  let label = "";

  if (m) {
    diceFormula = m[1].trim();
    label = text.slice(m[0].length).trim();
  } else {
    diceFormula = text;
  }

  if (!diceFormula) {
    return { error: "Could not find a valid dice formula in: " + raw };
  }

  return {
    diceFormula,
    advantage,
    disadvantage,
    label: label || "Roll"
  };
}

export function executeRoll(parsed, { name = "Player", actor = null, random = Math.random } = {}) {
  const { diceFormula, advantage, disadvantage, label } = parsed;
  const cleaned = diceFormula.replace(/[−–]/g, "-").replace(/\s+/g, "");
  const termRegex = /([+-]?)(?:(\d*)d(\d+)(?:k([hl])(\d+))?|(\d+))/gi;
  const matches = [...cleaned.matchAll(termRegex)].filter(m => m[0]);
  if (!matches.length) {
    throw new Error("Invalid dice expression: " + diceFormula);
  }

  const dice = [];
  const parts = [];
  let total = 0;
  const hasAdvantage = advantage && !disadvantage;
  const hasDisadvantage = disadvantage && !advantage;
  let keptVal = null;

  for (const m of matches) {
    const sign = m[1] === "-" ? -1 : 1;
    const signStr = sign < 0 ? "− " : (parts.length ? "+ " : "");
    if (m[6] != null) {
      // Flat modifier
      const flat = Number(m[6]);
      total += sign * flat;
      parts.push(signStr + flat);
    } else {
      let count = Number(m[2] || "1");
      const faces = Number(m[3]);
      const keepType = m[4]?.toLowerCase();
      const keepCount = m[5] != null ? Number(m[5]) : null;

      if (count > 50) throw new Error("Too many dice (maximum 50)");
      if (faces < 2 || faces > 1000) throw new Error("Invalid die size: d" + faces);

      // Handle d20 advantage / disadvantage
      let termAdv = false;
      let termDis = false;
      if (faces === 20 && count === 1 && (hasAdvantage || hasDisadvantage)) {
        count = 2;
        if (hasAdvantage) termAdv = true;
        if (hasDisadvantage) termDis = true;
      }

      // Roll each die
      const rolled = Array.from({ length: count }, () => 1 + Math.floor(random() * faces));

      // Determine kept vs discarded
      const keptIndices = new Set();
      if (termAdv) {
        const maxVal = Math.max(...rolled);
        const maxIdx = rolled.indexOf(maxVal);
        keptIndices.add(maxIdx);
      } else if (termDis) {
        const minVal = Math.min(...rolled);
        const minIdx = rolled.indexOf(minVal);
        keptIndices.add(minIdx);
      } else if (keepType && keepCount != null) {
        const sortedWithIndices = rolled.map((val, idx) => ({ val, idx }))
          .sort((a, b) => keepType === "h" ? b.val - a.val : a.val - b.val);
        for (let i = 0; i < Math.min(keepCount, sortedWithIndices.length); i++) {
          keptIndices.add(sortedWithIndices[i].idx);
        }
      } else {
        rolled.forEach((_, idx) => keptIndices.add(idx));
      }

      const termDice = rolled.map((value, idx) => {
        const discarded = !keptIndices.has(idx);
        return { faces, value, sign, discarded };
      });
      dice.push(...termDice);

      const keptValues = rolled.filter((_, idx) => keptIndices.has(idx));
      const subtotal = keptValues.reduce((s, v) => s + v, 0);
      total += sign * subtotal;

      if (termAdv || termDis) {
        keptVal = keptValues[0];
      }

      const notation = (count === 2 && (termAdv || termDis) ? "1d20" : count + "d" + faces) +
        (termAdv ? " (adv)" : termDis ? " (dis)" : keepType ? `k${keepType}${keepCount}` : "");
      parts.push(signStr + notation + " [" + rolled.join(", ") + "]" + (keptValues.length < rolled.length ? ` (kept ${keptValues.join(", ")})` : ""));
    }
  }

  const breakdown = parts.join(" ") + (parts.length > 1 || parts[0]?.includes("[") ? " = " + total : "");
  const advSuffix = hasAdvantage ? " (Advantage)" : hasDisadvantage ? " (Disadvantage)" : "";
  const actionTitle = label && label !== "Roll" ? `${label} · ${diceFormula}${advSuffix}` : `Roll · ${diceFormula}${advSuffix}`;

  const event = {
    name,
    action: actionTitle,
    kind: "chat-roll",
    side: "party",
    actor: actor?.id ?? "player",
    x: actor?.x,
    y: actor?.y,
    rolls: [
      {
        label: label || "Roll",
        dice,
        total,
        kept: keptVal,
        breakdown,
        advantage: hasAdvantage,
        disadvantage: hasDisadvantage
      }
    ]
  };

  return {
    diceFormula,
    label,
    total,
    kept: keptVal,
    dice,
    breakdown,
    advantage: hasAdvantage,
    disadvantage: hasDisadvantage,
    actionTitle,
    event
  };
}

const META_SEP = "\n\u200B";

export function formatRollMessage(rollResult) {
  const visible = `🎲 ${rollResult.actionTitle}: ${rollResult.total}\n${rollResult.breakdown}`;
  const payload = {
    _wr: 1,
    name: rollResult.event.name,
    action: rollResult.event.action,
    rolls: rollResult.event.rolls.map(r => ({
      label: r.label,
      total: r.total,
      kept: r.kept,
      breakdown: r.breakdown,
      advantage: r.advantage,
      disadvantage: r.disadvantage,
      dice: r.dice.map(d => [d.faces, d.value, d.sign, d.discarded ? 1 : 0])
    }))
  };
  return visible + META_SEP + JSON.stringify(payload);
}

export function parseRollMessage(body) {
  if (!body) return null;
  const parts = body.split(META_SEP);
  if (parts.length < 2) return null;
  try {
    const data = JSON.parse(parts[1]);
    if (!data || data._wr !== 1) return null;
    return {
      text: parts[0],
      name: data.name,
      action: data.action,
      rolls: data.rolls.map(r => ({
        label: r.label,
        total: r.total,
        kept: r.kept,
        breakdown: r.breakdown,
        advantage: r.advantage,
        disadvantage: r.disadvantage,
        dice: r.dice.map(([faces, value, sign, disc]) => ({
          faces, value, sign, discarded: Boolean(disc)
        }))
      }))
    };
  } catch {
    return null;
  }
}

export function visibleMessageText(body) {
  if (!body) return "";
  return body.split(META_SEP)[0];
}
