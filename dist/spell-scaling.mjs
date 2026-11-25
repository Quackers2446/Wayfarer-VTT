// Pure helpers for "how big is this spell at this slot / caster level".  Shared by the engine, UI and tests.
export const casterTier = level => [5, 11, 17].filter(threshold => (level ?? 1) >= threshold).length;
export const extraSlots = (rule, slot) => rule.level > 0 ? Math.max(0, (slot || rule.level) - rule.level) : 0;
const grow = (spec, rule, casterLevel, slot) => {
  if (!spec) return 0;
  return (spec.base ?? 1) + extraSlots(rule, slot) * (spec.perSlot ?? 0) + casterTier(casterLevel) * (spec.perTier ?? 0);
};
// Number of creatures (or beams / darts / rays) a creature-targeted rule may choose.
export function scaledTargets(rule, casterLevel, slot) {
  return rule.targets ? grow(rule.targets, rule, casterLevel, slot) : 1;
}
// Radius / side / length grow by `scale.<field>` feet per slot above the spell's level.
export const scaledSize = (rule, field, slot) => (rule[field] ?? 0) + extraSlots(rule, slot) * (rule.scale?.[field] ?? 0);
// Duration in seconds, growing by `scale.duration` per slot above the spell's level.
export const scaledDuration = (rule, slot) => (rule.duration ?? 0) + extraSlots(rule, slot) * (rule.scale?.duration ?? 0);
