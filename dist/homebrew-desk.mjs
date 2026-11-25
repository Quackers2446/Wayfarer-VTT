import {escape} from './format.mjs';
import {icon} from './icons.mjs';
import {damageTypes} from './spell-rule-schema.mjs';
import {
  homebrewSizes, homebrewCreatureTypes, homebrewItemKinds, homebrewRests,
  blankMonster, blankItem, blankFeature, homebrewId,
  monsterProblems, itemProblems, featureProblems,
  monsterStatBlock, itemToSheetEntry, itemToAttack, featureToSheetEntry,
} from './homebrew-schema.mjs';
import {
  loadHomebrew, listHomebrew, saveHomebrewMonster, saveHomebrewItem, saveHomebrewFeature,
  removeHomebrew, importHomebrewPack, exportHomebrewPack,
} from './homebrew-store.mjs';
import {loadSpellRules} from './spell-rule-store.mjs';

const option = (value, label, selected) =>
  `<option value="${escape(value)}"${selected ? ' selected' : ''}>${escape(label)}</option>`;

function field(label, name, value, attrs = '') {
  return `<label>${escape(label)}<input name="${escape(name)}" value="${escape(value ?? '')}" ${attrs}></label>`;
}

function select(label, name, value, choices) {
  return `<label>${escape(label)}<select name="${escape(name)}">${choices.map(([key, text]) =>
    option(key, text, String(value) === String(key))).join('')}</select></label>`;
}

function area(label, name, value, attrs = '') {
  return `<label class="homebrew-wide">${escape(label)}<textarea name="${escape(name)}" ${attrs}>${escape(value ?? '')}</textarea></label>`;
}

function validation(problems) {
  return `<p class="homebrew-validation" role="status">${problems.length ? escape(problems.join(' ')) : 'Ready to save.'}</p>`;
}

export function mountHomebrewDesk(host, {onAddToCharacter} = {}) {
  let tab = 'monsters';
  let selectedId = null;
  let draft = null;
  let statusText = '';
  let query = '';

  const setStatus = (text) => { statusText = text; };

  function ensureDraft() {
    if (draft) return draft;
    if (tab === 'monsters') draft = blankMonster();
    else if (tab === 'items') draft = blankItem();
    else draft = blankFeature();
    selectedId = null;
    return draft;
  }

  function choose(id) {
    const entry = listHomebrew(tab).find((item) => item.id === id);
    if (!entry) return;
    selectedId = id;
    draft = structuredClone(entry);
    render();
  }

  function createNew() {
    selectedId = null;
    draft = tab === 'monsters' ? blankMonster() : tab === 'items' ? blankItem() : blankFeature();
    render();
    host.querySelector('[name=name]')?.focus();
  }

  function readForm(form) {
    const data = new FormData(form);
    if (tab === 'monsters') {
      const name = String(data.get('name') || '').trim();
      const attacks = [];
      for (let i = 0; i < 8; i++) {
        const attackName = String(data.get('attack-name-' + i) || '').trim();
        if (!attackName) continue;
        const attack = {
          name: attackName,
          bonus: Number(data.get('attack-bonus-' + i)),
          damage: String(data.get('attack-damage-' + i) || '').trim(),
          type: String(data.get('attack-type-' + i) || 'bludgeoning'),
          reach: Number(data.get('attack-reach-' + i)) || 5,
        };
        const range = Number(data.get('attack-range-' + i));
        if (Number.isFinite(range) && range > 0) {
          attack.normalRange = range;
          attack.longRange = Number(data.get('attack-long-' + i)) || range;
        }
        attacks.push(attack);
      }
      return {
        id: homebrewId(name), name,
        size: String(data.get('size') || 'M'),
        creatureType: String(data.get('creatureType') || 'humanoid'),
        ac: Number(data.get('ac')),
        hp: Number(data.get('hp')),
        speed: Number(data.get('speed')),
        str: Number(data.get('str')), dex: Number(data.get('dex')), con: Number(data.get('con')),
        int: Number(data.get('int')), wis: Number(data.get('wis')), cha: Number(data.get('cha')),
        cr: String(data.get('cr') || '').trim() || null,
        attacks, traits: String(data.get('traits') || ''), notes: String(data.get('notes') || ''),
        side: String(data.get('side') || 'hostile'),
      };
    }
    if (tab === 'items') {
      const name = String(data.get('name') || '').trim();
      const kind = String(data.get('kind') || 'gear');
      const item = {
        id: homebrewId(name), name, kind,
        weight: data.get('weight') === '' ? 0 : Number(data.get('weight')),
        note: String(data.get('note') || ''),
      };
      if (kind === 'potion') item.formula = String(data.get('formula') || '').trim();
      if (kind === 'weapon') {
        item.bonus = Number(data.get('bonus'));
        item.damage = String(data.get('damage') || '').trim();
        item.damageType = String(data.get('damageType') || 'slashing');
        item.finesse = data.get('finesse') === 'on';
        item.reach = Number(data.get('reach')) || 5;
        const range = Number(data.get('normalRange'));
        if (Number.isFinite(range) && range > 0) item.normalRange = range;
      }
      if (kind === 'gear') {
        const formula = String(data.get('formula') || '').trim();
        if (formula) item.formula = formula;
      }
      return item;
    }
    const name = String(data.get('name') || '').trim();
    const resourceName = String(data.get('resourceName') || '').trim();
    return {
      id: homebrewId(name), name,
      className: String(data.get('className') || '').trim(),
      level: data.get('level') === '' ? null : Number(data.get('level')),
      description: String(data.get('description') || ''),
      resourceName,
      resourceMax: resourceName ? Number(data.get('resourceMax')) : null,
      resourceRest: resourceName ? String(data.get('resourceRest') || 'long') : null,
    };
  }

  function monsterForm(monster) {
    const attacks = [...(monster.attacks ?? [])];
    while (attacks.length < Math.min(8, Math.max(1, attacks.length + 1))) {
      attacks.push({name: '', bonus: 2, damage: '1d4', type: 'bludgeoning', reach: 5});
    }
    return `<form class="homebrew-form" data-homebrew-form>
      <div class="homebrew-fields">
        ${field('Creature name', 'name', monster.name, 'required maxlength="120"')}
        ${select('Size', 'size', monster.size, homebrewSizes.map((size) => [size, size]))}
        ${select('Type', 'creatureType', monster.creatureType, homebrewCreatureTypes.map((type) => [type, type]))}
        ${field('Armor Class', 'ac', monster.ac, 'type="number" min="1" max="40" required')}
        ${field('Hit points', 'hp', monster.hp, 'type="number" min="1" max="2000" required')}
        ${field('Speed (ft)', 'speed', monster.speed, 'type="number" min="0" max="120" required')}
        ${field('CR', 'cr', monster.cr ?? '', 'maxlength="12" placeholder="1/2"')}
        ${select('Default disposition', 'side', monster.side ?? 'hostile', [['hostile', 'Hostile'], ['neutral', 'Neutral']])}
      </div>
      <div class="homebrew-fields homebrew-abilities">
        ${['str', 'dex', 'con', 'int', 'wis', 'cha'].map((ability) =>
          field(ability.toUpperCase(), ability, monster[ability], 'type="number" min="1" max="30" required')).join('')}
      </div>
      <fieldset><legend>Attacks</legend>
        ${attacks.map((attack, index) => `<div class="homebrew-attack">
          ${field('Name', 'attack-name-' + index, attack.name, 'maxlength="80" placeholder="Scimitar"')}
          ${field('Bonus', 'attack-bonus-' + index, attack.bonus ?? 2, 'type="number" min="-10" max="40"')}
          ${field('Damage', 'attack-damage-' + index, attack.damage ?? '1d6', 'placeholder="1d6+2"')}
          ${select('Type', 'attack-type-' + index, attack.type ?? 'slashing', damageTypes.map((type) => [type, type]))}
          ${field('Reach', 'attack-reach-' + index, attack.reach ?? 5, 'type="number" min="5" max="30" step="5"')}
          ${field('Range', 'attack-range-' + index, attack.normalRange ?? '', 'type="number" min="5" max="600" step="5" placeholder="Melee"')}
          ${field('Long range', 'attack-long-' + index, attack.longRange ?? '', 'type="number" min="5" max="1200" step="5"')}
        </div>`).join('')}
        <p class="homebrew-hint">Leave an attack name blank to omit it. Traits and legendary actions still need a table ruling.</p>
      </fieldset>
      ${area('Traits & special abilities', 'traits', monster.traits, 'rows="4" maxlength="4000" placeholder="Pack Tactics. The creature has advantage on attack rolls against a creature if at least one ally is within 5 feet…"')}
      ${area('DM notes', 'notes', monster.notes, 'rows="2" maxlength="1000"')}
      ${validation(monsterProblems(monster))}
      <div class="homebrew-actions">
        <button class="button primary" type="submit">Save creature</button>
        ${selectedId ? '<button class="button outline" type="button" data-homebrew-action="delete">Delete</button>' : ''}
        <button class="button outline" type="button" data-homebrew-action="place-hint">Use in play</button>
      </div>
    </form>`;
  }

  function itemForm(item) {
    return `<form class="homebrew-form" data-homebrew-form>
      <div class="homebrew-fields">
        ${field('Item name', 'name', item.name, 'required maxlength="140"')}
        ${select('Kind', 'kind', item.kind, homebrewItemKinds.map((kind) => [kind, kind[0].toUpperCase() + kind.slice(1)]))}
        ${field('Weight (lbs)', 'weight', item.weight ?? 0, 'type="number" min="0" max="99999" step="0.1"')}
      </div>
      ${item.kind === 'potion' || item.kind === 'gear' ? field('Healing / dice formula', 'formula', item.formula ?? '', 'placeholder="2d4+2"') : ''}
      ${item.kind === 'weapon' ? `<div class="homebrew-fields">
        ${field('Attack bonus', 'bonus', item.bonus ?? 3, 'type="number" min="-10" max="40"')}
        ${field('Damage dice', 'damage', item.damage ?? '1d8+1', 'placeholder="1d8+3"')}
        ${select('Damage type', 'damageType', item.damageType ?? 'slashing', damageTypes.map((type) => [type, type]))}
        ${field('Reach (ft)', 'reach', item.reach ?? 5, 'type="number" min="5" max="30" step="5"')}
        ${field('Ranged limit (ft)', 'normalRange', item.normalRange ?? '', 'type="number" min="5" max="600" step="5" placeholder="Melee"')}
        <label class="homebrew-check"><input type="checkbox" name="finesse"${item.finesse ? ' checked' : ''}> Finesse</label>
      </div>` : ''}
      ${area('Notes', 'note', item.note, 'rows="3" maxlength="2000"')}
      ${validation(itemProblems(item))}
      <div class="homebrew-actions">
        <button class="button primary" type="submit">Save item</button>
        ${selectedId ? '<button class="button outline" type="button" data-homebrew-action="delete">Delete</button>' : ''}
        <button class="button outline" type="button" data-homebrew-action="copy-item">Copy for a sheet</button>
      </div>
      <p class="homebrew-hint">Potions with a formula appear under Use item in play. Weapons can also add an attack entry when copied to a sheet.</p>
    </form>`;
  }

  function featureForm(feature) {
    return `<form class="homebrew-form" data-homebrew-form>
      <div class="homebrew-fields">
        ${field('Feature name', 'name', feature.name, 'required maxlength="120"')}
        ${field('Class / subclass (optional)', 'className', feature.className ?? '', 'maxlength="80" placeholder="Fighter · Champion"')}
        ${field('Level', 'level', feature.level ?? '', 'type="number" min="1" max="20"')}
      </div>
      ${area('Description', 'description', feature.description, 'rows="6" maxlength="6000" required')}
      <fieldset><legend>Optional resource pool</legend>
        <div class="homebrew-fields">
          ${field('Resource name', 'resourceName', feature.resourceName ?? '', 'maxlength="80" placeholder="Ki, Rage, Focus…"')}
          ${field('Maximum', 'resourceMax', feature.resourceMax ?? '', 'type="number" min="1" max="99"')}
          ${select('Recovers on', 'resourceRest', feature.resourceRest ?? 'long', homebrewRests.map((rest) => [rest, rest === 'short' ? 'Short or long rest' : 'Long rest']))}
        </div>
        <p class="homebrew-hint">Resource pools track uses on the sheet and in play. Feature effects themselves still need a table ruling unless an existing class action covers them.</p>
      </fieldset>
      ${validation(featureProblems(feature))}
      <div class="homebrew-actions">
        <button class="button primary" type="submit">Save feature</button>
        ${selectedId ? '<button class="button outline" type="button" data-homebrew-action="delete">Delete</button>' : ''}
        <button class="button outline" type="button" data-homebrew-action="copy-feature">Copy for a sheet</button>
      </div>
    </form>`;
  }

  function spellsPanel() {
    const rules = Object.values(loadSpellRules()).filter((rule) => String(rule.source).toUpperCase() === 'HB' || String(rule.reference).startsWith('hb|'));
    return `<div class="homebrew-spells">
      <p>Custom spell automation lives in the <a class="text-link" href="#spell-library">Spell library</a>. Create a homebrew spell there, enable its rules when they are runnable, or leave effects empty and mark casts as manual from the character sheet.</p>
      <div class="homebrew-actions">
        <a class="button primary" href="#spell-library">${icon('sparkles', 16)} Open spell library</a>
        <a class="button outline" href="#spell-library" data-homebrew-create-spell>Create homebrew spell</a>
      </div>
      <h3>Saved homebrew spell rules · ${rules.length}</h3>
      ${rules.length ? `<ul class="homebrew-list">${rules.map((rule) => `<li>
        <strong>${escape(rule.name)}</strong>
        <span>${rule.enabled ? 'Enabled' : 'Draft'} · ${rule.level ? 'L' + rule.level : 'Cantrip'}${ruleProblemsBadge(rule)}</span>
      </li>`).join('')}</ul>` : '<p class="homebrew-hint">No HB-source spell rules saved yet.</p>'}
      <p class="homebrew-hint">Foundry JSON imports already exist on the Spell library page for matching published spells. Fully custom names use source <code>HB</code>.</p>
    </div>`;
  }

  function ruleProblemsBadge(rule) {
    try {
      // Lazy: show enabled/draft only; validation lives in the spell editor.
      return rule.enabled ? '' : ' · review in Spell library';
    } catch {
      return '';
    }
  }

  function listPanel() {
    const entries = listHomebrew(tab).filter((entry) =>
      !query || (entry.name + ' ' + (entry.note ?? '') + ' ' + (entry.className ?? '')).toLowerCase().includes(query.toLowerCase()));
    return `<aside class="homebrew-library">
      <label class="search-field">${icon('search', 18)}<span class="sr-only">Search homebrew</span>
        <input type="search" class="homebrew-search" value="${escape(query)}" placeholder="Search…"></label>
      <button type="button" class="button primary small" data-homebrew-action="new">${icon('plus', 14)} New ${tab.slice(0, -1)}</button>
      <div class="homebrew-entry-list">${entries.map((entry) => `<button type="button" data-homebrew-select="${escape(entry.id)}" aria-pressed="${selectedId === entry.id}">
        <strong>${escape(entry.name)}</strong>
        <span>${tab === 'monsters' ? escape(entry.creatureType) + ' · AC ' + entry.ac
          : tab === 'items' ? escape(entry.kind) : escape(entry.className || 'Feature')}</span>
      </button>`).join('') || '<p>No matching entries.</p>'}</div>
    </aside>`;
  }

  function render() {
    const pack = loadHomebrew();
    ensureDraft();
    host.innerHTML = `<section class="homebrew-desk" aria-label="Homebrew library">
      <header class="homebrew-heading">
        <div>
          <h1>Homebrew</h1>
          <p>Add custom creatures, items, features, and spell rules the table can use without waiting on the published archive.</p>
        </div>
        <div class="homebrew-actions">
          <button type="button" class="button outline small" data-homebrew-action="export">${icon('upload', 14)} Export pack</button>
          <button type="button" class="button outline small" data-homebrew-action="import">${icon('file', 14)} Import pack</button>
          <input type="file" accept="application/json,.json" class="homebrew-import" hidden>
        </div>
      </header>
      <div class="library-tabs" aria-label="Homebrew kind">
        ${[['monsters', 'Creatures', pack.monsters], ['items', 'Items', pack.items], ['features', 'Features', pack.features], ['spells', 'Spells', null]].map(([id, label, group]) =>
          `<button type="button" data-homebrew-tab="${id}" aria-pressed="${tab === id}">${escape(label)}${group ? `<span>${Object.keys(group).length}</span>` : ''}</button>`).join('')}
      </div>
      ${tab === 'spells' ? spellsPanel() : `<div class="homebrew-workspace">
        ${listPanel()}
        <div class="homebrew-editor">
          <header class="homebrew-selected"><div><h2>${escape(draft.name || 'Untitled')}</h2>
            <p>${selectedId ? 'Editing saved homebrew' : 'New draft · save to keep it in this browser'}</p></div></header>
          ${tab === 'monsters' ? monsterForm(draft) : tab === 'items' ? itemForm(draft) : featureForm(draft)}
        </div>
      </div>`}
      <p class="homebrew-status" role="status">${escape(statusText)}</p>
      <p class="homebrew-hint">Homebrew packs stay in this browser (export/import to share). Homebrew <em>spells</em> sync with your account through the Spell library. Items and features copied onto a character sheet travel with that sheet.</p>
    </section>`;
  }

  host.addEventListener('click', (event) => {
    const tabButton = event.target.closest('[data-homebrew-tab]');
    if (tabButton) {
      tab = tabButton.dataset.homebrewTab;
      selectedId = null;
      draft = null;
      query = '';
      render();
      return;
    }
    const selectButton = event.target.closest('[data-homebrew-select]');
    if (selectButton) {
      choose(selectButton.dataset.homebrewSelect);
      return;
    }
    const createSpell = event.target.closest('[data-homebrew-create-spell]');
    if (createSpell) {
      sessionStorage.setItem('wayfarer-create-homebrew-spell', '1');
      return;
    }
    const action = event.target.closest('[data-homebrew-action]')?.dataset.homebrewAction;
    if (!action) return;
    try {
      if (action === 'new') createNew();
      else if (action === 'export') {
        const blob = new Blob([JSON.stringify(exportHomebrewPack(), null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'wayfarer-homebrew.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus('Homebrew pack exported.');
        host.querySelector('.homebrew-status').textContent = statusText;
      } else if (action === 'import') host.querySelector('.homebrew-import')?.click();
      else if (action === 'delete') {
        if (!selectedId || !window.confirm('Delete this homebrew entry from this browser?')) return;
        removeHomebrew(tab, selectedId);
        selectedId = null;
        draft = null;
        setStatus('Deleted.');
        render();
      } else if (action === 'place-hint') {
        setStatus('In Rooms → open a map → Room panel → choose a Homebrew creature → Add token.');
        host.querySelector('.homebrew-status').textContent = statusText;
      } else if (action === 'copy-item') {
        const item = readForm(host.querySelector('[data-homebrew-form]'));
        const sheetItem = itemToSheetEntry(item);
        const attack = itemToAttack(item);
        if (typeof onAddToCharacter === 'function') {
          const ok = onAddToCharacter({kind: 'item', item: sheetItem, attack});
          setStatus(ok ? 'Choose a character sheet, then use Add from homebrew — or copy succeeded.' : 'Open a character sheet Inventory and use “Add from homebrew”, or save this item and add it there.');
        } else {
          sessionStorage.setItem('wayfarer-homebrew-pending-item', JSON.stringify({item: sheetItem, attack}));
          setStatus('Saved to clipboard buffer. Open a character Inventory and click Add from homebrew.');
        }
        host.querySelector('.homebrew-status').textContent = statusText;
      } else if (action === 'copy-feature') {
        const feature = featureToSheetEntry(readForm(host.querySelector('[data-homebrew-form]')));
        sessionStorage.setItem('wayfarer-homebrew-pending-feature', JSON.stringify(feature));
        setStatus('Saved to clipboard buffer. Open a character sheet and click Add homebrew feature.');
        host.querySelector('.homebrew-status').textContent = statusText;
      }
    } catch (error) {
      setStatus(error.message);
      host.querySelector('.homebrew-status').textContent = statusText;
    }
  });

  host.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-homebrew-form]');
    if (!form) return;
    event.preventDefault();
    try {
      const entry = readForm(form);
      if (tab === 'monsters') {
        monsterStatBlock(entry);
        saveHomebrewMonster(entry);
      } else if (tab === 'items') saveHomebrewItem(entry);
      else saveHomebrewFeature(entry);
      selectedId = entry.id;
      draft = structuredClone(entry);
      setStatus('Saved in this browser.');
      render();
    } catch (error) {
      setStatus(error.message);
      host.querySelector('.homebrew-status').textContent = statusText;
    }
  });

  host.addEventListener('change', (event) => {
    if (event.target.matches('.homebrew-import')) {
      void (async () => {
        try {
          const file = event.target.files?.[0];
          if (!file || file.size > 1_500_000) throw Error('Choose a homebrew JSON pack up to 1.5 MB.');
          importHomebrewPack(JSON.parse(await file.text()));
          selectedId = null;
          draft = null;
          setStatus('Homebrew pack imported.');
          render();
        } catch (error) {
          setStatus(error.message);
          host.querySelector('.homebrew-status').textContent = statusText;
        } finally {
          event.target.value = '';
        }
      })();
      return;
    }
    if (event.target.name === 'kind') {
      const form = host.querySelector('[data-homebrew-form]');
      if (!form) return;
      const current = readForm(form);
      draft = blankItem(current.name || 'Custom Item', event.target.value);
      if (current.note) draft.note = current.note;
      if (current.weight != null) draft.weight = current.weight;
      render();
    }
  });

  host.addEventListener('input', (event) => {
    if (!event.target.matches('.homebrew-search')) return;
    query = event.target.value;
    const form = host.querySelector('[data-homebrew-form]');
    if (form) draft = readForm(form);
    render();
    const search = host.querySelector('.homebrew-search');
    if (search) {
      search.focus();
      const end = search.value.length;
      search.setSelectionRange(end, end);
    }
  });

  render();
}
