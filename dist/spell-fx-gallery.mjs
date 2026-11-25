import {builtinList} from './spell-library/index.mjs';
import {defaultSpellAnimation,builtinSpellColors} from './spell-animation-library.mjs';
import {escape} from './format.mjs';

const shapeLabels = {
  creature: 'Creature',
  target: 'Creature',
  self: 'Self',
  point: 'Map point',
  circle: 'Circle / cylinder',
  cube: 'Cube',
  cone: 'Cone',
  line: 'Line',
  wall: 'Wall',
  ring: 'Ring',
  aura: 'Aura',
  movable: 'Movable sphere',
  sphere: 'Movable sphere',
};
const timingLabels = {action: 'Action', bonus: 'Bonus action'};
const triggerLabels = {
  cast: 'on cast',
  enter: 'on entry',
  start: 'start of turn',
  end: 'end of turn',
  ram: 'on ram',
  step: 'per 5 ft through',
};

function levelLabel(level) {
  return level ? 'Level ' + level : 'Cantrip';
}

function shapeSummary(rule) {
  const shape = shapeLabels[rule.shape] ?? rule.shape ?? 'Target';
  const parts = [timingLabels[rule.timing] ?? rule.timing ?? 'Action', shape];
  if (rule.shape !== 'self' && Number.isFinite(rule.range)) parts.push(rule.range + ' ft range');
  if (['circle', 'cone', 'ring', 'sphere', 'aura'].includes(rule.shape) && Number.isFinite(rule.radius)) {
    parts.push((rule.shape === 'cone' ? 'length ' : 'radius ') + rule.radius + ' ft');
  }
  if (rule.shape === 'cube' && Number.isFinite(rule.side)) parts.push(rule.side + ' ft side');
  if (['line', 'wall'].includes(rule.shape) && Number.isFinite(rule.length)) parts.push(rule.length + ' ft length');
  if (rule.attack) parts.push(typeof rule.attack === 'string' ? rule.attack + ' attack' : 'spell attack');
  if (rule.targets?.base) {
    parts.push(rule.targets.base + (rule.targets.base === 1 ? ' target' : ' targets') +
      (rule.targets.perSlot ? ' (+' + rule.targets.perSlot + '/slot)' : ''));
  }
  return parts.join(' · ');
}

function effectBlurb(rule) {
  const bits = [];
  for (const effect of rule.effects ?? []) {
    const when = triggerLabels[effect.trigger] ?? effect.trigger;
    const save = effect.save ? effect.save.toUpperCase() + ' save' + (effect.onSave === 'half' ? ' (half)' : effect.onSave === 'none' ? ' (negates)' : '') : '';
    if (effect.kind === 'healing' || (effect.damage?.length && effect.kind === 'healing')) {
      const rolls = (effect.damage ?? []).map(part => part.formula + (part.addAbility ? '+mod' : '') + (part.upcast ? ' (+' + part.upcast + (part.scaleWithCaster ? ' cantrip scale' : '/slot') + ')' : '')).join(' + ');
      bits.push((rolls || 'Heal') + ' healing' + (when !== 'on cast' ? ' ' + when : '') + (save ? '; ' + save : ''));
      continue;
    }
    if (effect.damage?.length) {
      const rolls = effect.damage.map(part => {
        let text = part.formula + (part.type ? ' ' + part.type : '');
        if (part.addAbility) text += '+mod';
        if (part.upcast) text += ' (+' + part.upcast + (part.scaleWithCaster ? ' cantrip scale' : '/slot') + ')';
        return text;
      }).join(' + ');
      bits.push(rolls + (when !== 'on cast' ? ' ' + when : '') + (save ? '; ' + save : '') + (effect.condition ? '; ' + effect.condition + ' on fail' : ''));
      continue;
    }
    if (effect.condition) bits.push(effect.condition + (when !== 'on cast' ? ' ' + when : '') + (save ? '; ' + save : ''));
    else if (effect.status?.name) bits.push(effect.status.name + (when !== 'on cast' ? ' ' + when : '') + (save ? '; ' + save : ''));
    else if (effect.kind === 'summon') bits.push('Summon' + (when !== 'on cast' ? ' ' + when : ''));
    else if (effect.kind === 'dispel') bits.push('Dispel' + (effect.dispel?.level != null ? ' (≤ L' + effect.dispel.level + ')' : '') + (when !== 'on cast' ? ' ' + when : ''));
    else if (effect.kind === 'teleport') bits.push('Teleport' + (when !== 'on cast' ? ' ' + when : ''));
    else if (effect.kind === 'sleep') bits.push('Sleep pool ' + (effect.sleepPool ?? '') + (when !== 'on cast' ? ' ' + when : ''));
    else if (effect.kind === 'modifier') {
      const mods = [];
      if (effect.modifiers?.attack) mods.push('attack ' + effect.modifiers.attack);
      if (effect.modifiers?.save) mods.push('save ' + effect.modifiers.save);
      if (mods.length) bits.push(mods.join(', ') + (when !== 'on cast' ? ' ' + when : ''));
    } else if (effect.tempHp) bits.push(effect.tempHp + ' temp HP' + (when !== 'on cast' ? ' ' + when : ''));
    else if (effect.status) bits.push('Status effect' + (when !== 'on cast' ? ' ' + when : ''));
  }
  const flags = [];
  if (rule.concentration) flags.push('concentration');
  if (rule.persistent) flags.push('persistent area');
  if (rule.endNextTurn) flags.push('ends next turn');
  if (rule.difficult) flags.push('difficult terrain');
  if (rule.blocksVision) flags.push('blocks vision');
  if (rule.blocksRanged) flags.push('deflects ranged');
  if (rule.blocksMovement) flags.push('blocks movement');
  if (Number(rule.duration) > 0) flags.push(rule.duration >= 60 ? (rule.duration / 60) + ' min' : rule.duration + 's');
  if (Number(rule.nearby) > 0) flags.push(rule.nearby + ' ft nearby');
  if (Number(rule.move) > 0) flags.push('move ' + rule.move + ' ft');
  if (rule.nativeKey) flags.push('native implementation');
  const body = bits.length ? bits.join(' · ') : 'No automated damage or condition blocks.';
  return flags.length ? body + ' · ' + flags.join(' · ') : body;
}

function resolvedVisual(rule) {
  return defaultSpellAnimation(rule.name, rule) ?? null;
}

function fxKind(visual) {
  if (visual?.url) return 'video';
  if (visual?.builtin) return 'builtin';
  return 'none';
}

function fxTag(visual) {
  const kind = fxKind(visual);
  if (kind === 'video') return 'Video';
  if (kind === 'builtin') return 'Color FX';
  return 'No clip';
}

function catalogEntries() {
  return builtinList()
    .map(rule => {
      const visual = resolvedVisual(rule);
      return {
        rule,
        visual,
        kind: fxKind(visual),
        shape: shapeSummary(rule),
        blurb: effectBlurb(rule),
      };
    })
    .sort((a, b) => a.rule.name.localeCompare(b.rule.name) || a.rule.source.localeCompare(b.rule.source) || a.rule.level - b.rule.level);
}

export function mountSpellFxGallery(host) {
  const entries = catalogEntries();
  let query = '';
  let level = 'all';
  let source = 'all';
  let videoOnly = false;
  let selected = entries[0] ?? null;
  let previewVideo;

  const sources = [...new Set(entries.map(entry => entry.rule.source))].sort();
  const levels = [...new Set(entries.map(entry => entry.rule.level))].sort((a, b) => a - b);

  function matches() {
    const needle = query.trim().toLowerCase();
    return entries.filter(entry => {
      if (needle && !entry.rule.name.toLowerCase().includes(needle) && !entry.rule.reference.toLowerCase().includes(needle)) return false;
      if (level !== 'all' && String(entry.rule.level) !== level) return false;
      if (source !== 'all' && entry.rule.source !== source) return false;
      if (videoOnly && entry.kind !== 'video') return false;
      return true;
    });
  }

  function stopPreview() {
    if (!previewVideo) return;
    previewVideo.pause();
    previewVideo.removeAttribute('src');
    previewVideo.load();
    previewVideo = null;
  }

  function playSelected() {
    const stage = host.querySelector('.fx-preview-stage');
    const note = host.querySelector('.fx-preview-note');
    if (!stage || !selected) return;
    stopPreview();
    stage.replaceChildren();
    const visual = selected.visual;
    if (visual?.url) {
      const video = document.createElement('video');
      video.src = visual.url;
      video.controls = true;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.addEventListener('error', () => {
        if (note) note.textContent = 'This animation could not be loaded. Check the clip path and hosting permissions.';
      }, {once: true});
      stage.append(video);
      previewVideo = video;
      void video.play().catch(() => {});
      if (note) note.textContent = (visual.label || 'Spell animation') + (visual.kind ? ' · ' + visual.kind : '');
      return;
    }
    if (visual?.builtin) {
      const color = builtinSpellColors[visual.builtin] ?? '#aa87ec';
      const swatch = document.createElement('div');
      swatch.className = 'fx-builtin-swatch';
      swatch.dataset.kind = visual.kind || 'burst';
      swatch.style.setProperty('--spell-color', color);
      swatch.innerHTML = `<span>${escape(visual.builtin)}</span><small>${escape(visual.kind || 'burst')} · board color effect</small>`;
      stage.append(swatch);
      if (note) note.textContent = 'Built-in color effect — plays on the game board, no video clip.';
      return;
    }
    const empty = document.createElement('p');
    empty.className = 'fx-no-clip';
    empty.textContent = 'No resolved animation clip for this spell.';
    stage.append(empty);
    if (note) note.textContent = 'No matching free clip or color fallback.';
  }

  function listHtml(list) {
    if (!list.length) return '<p class="fx-empty">No matching built-in spells.</p>';
    return list.map(entry => {
      const active = selected?.rule.reference === entry.rule.reference;
      const tags = [
        entry.rule.source,
        levelLabel(entry.rule.level),
        fxTag(entry.visual),
      ];
      return `<button type="button" class="fx-spell-item" data-fx-select="${escape(entry.rule.reference)}" aria-pressed="${active}">
        <strong>${escape(entry.rule.name)}</strong>
        <span class="rule-tags">${tags.map(tag => `<span class="rule-tag">${escape(tag)}</span>`).join('')}</span>
        <small>${escape(entry.shape)}</small>
      </button>`;
    }).join('');
  }

  function detailHtml(entry) {
    if (!entry) return '<p>No built-in spells are loaded.</p>';
    const visual = entry.visual;
    const kind = entry.kind;
    const animLine = kind === 'video'
      ? (visual.label || 'Video clip') + (visual.kind ? ' · ' + visual.kind : '')
      : kind === 'builtin'
        ? 'Built-in color effect (' + visual.builtin + ', ' + (visual.kind || 'burst') + ')'
        : 'No clip';
    return `<header class="rule-selected-heading"><div>
      <h2>${escape(entry.rule.name)}</h2>
      <p>${escape(entry.rule.source)} · ${escape(entry.rule.edition)} · ${escape(levelLabel(entry.rule.level))} · <code>${escape(entry.rule.reference)}</code></p>
    </div>
    <span class="fx-kind-badge fx-kind-${kind}">${escape(fxTag(visual))}</span></header>
    <dl class="fx-facts">
      <div><dt>Shape &amp; timing</dt><dd>${escape(entry.shape)}</dd></div>
      <div><dt>Effect / rules</dt><dd>${escape(entry.blurb)}</dd></div>
      <div><dt>Resolved animation</dt><dd>${escape(animLine)}</dd></div>
    </dl>
    <fieldset class="fx-preview-panel"><legend>Animation preview</legend>
      <p>Included animations by <a href="https://jb2a.com/" target="_blank" rel="noopener">JB2A — Jules &amp; Ben</a>, <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>. <a href="/assets/animations/credits.json" target="_blank" rel="noopener">Sources and credits</a>.</p>
      <div class="fx-preview-toolbar">
        <button type="button" class="button primary small" data-fx-action="play"${kind === 'none' ? ' disabled' : ''}>Play animation</button>
        <button type="button" class="button outline small" data-fx-action="stop">Stop</button>
      </div>
      <div class="fx-preview-stage" aria-live="polite"></div>
      <p class="fx-preview-note" role="status"></p>
    </fieldset>`;
  }

  function render() {
    const list = matches();
    if (selected && !list.some(entry => entry.rule.reference === selected.rule.reference)) selected = list[0] ?? null;
    const videoCount = entries.filter(entry => entry.kind === 'video').length;
    const builtinCount = entries.filter(entry => entry.kind === 'builtin').length;
    const noneCount = entries.filter(entry => entry.kind === 'none').length;
    host.innerHTML = `<section class="spell-fx-desk spell-rule-desk" aria-label="Spell FX preview gallery">
      <header class="rule-page-heading"><div>
        <h1>Spell FX preview</h1>
        <p>Browse every built-in combat spell, read its automation summary, and play the resolved JB2A (or color) animation — no room required.</p>
      </div></header>
      <div class="rule-workspace fx-workspace">
        <aside class="rule-library fx-library" aria-label="Built-in spells">
          <label>Search<input class="fx-search" type="search" value="${escape(query)}" placeholder="Spell name"></label>
          <label>Level<select class="fx-level">${[['all', 'All levels'], ...levels.map(value => [String(value), value ? 'Level ' + value : 'Cantrips'])].map(([value, label]) =>
            `<option value="${escape(value)}"${String(level) === value ? ' selected' : ''}>${escape(label)}</option>`).join('')}</select></label>
          <label>Source<select class="fx-source">${[['all', 'All sources'], ...sources.map(value => [value, value])].map(([value, label]) =>
            `<option value="${escape(value)}"${source === value ? ' selected' : ''}>${escape(label)}</option>`).join('')}</select></label>
          <label class="rule-check fx-video-only"><input type="checkbox" class="fx-video-filter"${videoOnly ? ' checked' : ''}>Only spells with video</label>
          <p class="rule-search-count">${list.length} shown · ${entries.length} built-in · ${videoCount} video · ${builtinCount} color · ${noneCount} none</p>
          <div class="rule-spell-list fx-spell-list">${listHtml(list)}</div>
        </aside>
        <div class="rule-editor-main fx-detail">${detailHtml(selected)}</div>
      </div>
    </section>`;
    if (selected) playSelected();
  }

  host.addEventListener('input', event => {
    if (event.target.matches('.fx-search')) {
      query = event.target.value;
      const list = host.querySelector('.fx-spell-list');
      const count = host.querySelector('.rule-search-count');
      const filtered = matches();
      if (selected && !filtered.some(entry => entry.rule.reference === selected.rule.reference)) {
        selected = filtered[0] ?? null;
        const detail = host.querySelector('.fx-detail');
        if (detail) detail.innerHTML = detailHtml(selected);
        if (selected) playSelected();
        else stopPreview();
      }
      if (list) list.innerHTML = listHtml(filtered);
      if (count) {
        const videoCount = entries.filter(entry => entry.kind === 'video').length;
        const builtinCount = entries.filter(entry => entry.kind === 'builtin').length;
        const noneCount = entries.filter(entry => entry.kind === 'none').length;
        count.textContent = `${filtered.length} shown · ${entries.length} built-in · ${videoCount} video · ${builtinCount} color · ${noneCount} none`;
      }
    }
  });

  host.addEventListener('change', event => {
    if (event.target.matches('.fx-level')) { level = event.target.value; render(); }
    if (event.target.matches('.fx-source')) { source = event.target.value; render(); }
    if (event.target.matches('.fx-video-filter')) { videoOnly = event.target.checked; render(); }
  });

  host.addEventListener('click', event => {
    const pick = event.target.closest('[data-fx-select]');
    if (pick) {
      selected = entries.find(entry => entry.rule.reference === pick.dataset.fxSelect) ?? null;
      render();
      host.querySelector(`[data-fx-select="${CSS.escape(pick.dataset.fxSelect)}"]`)?.focus();
      return;
    }
    const action = event.target.closest('[data-fx-action]')?.dataset.fxAction;
    if (action === 'play') playSelected();
    if (action === 'stop') {
      stopPreview();
      const stage = host.querySelector('.fx-preview-stage');
      if (stage) stage.replaceChildren();
      const note = host.querySelector('.fx-preview-note');
      if (note) note.textContent = 'Preview stopped.';
    }
  });

  render();
}
