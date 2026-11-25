// Spell Library preview must not mutate the player's wayfarer-dice-fx preference.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCombatCues} from '../dist/combat-cues.mjs';

const store = new Map([['wayfarer-dice-fx', 'on']]);
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
};
globalThis.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.window = {
  visualViewport: {width: 1200, height: 800, offsetLeft: 0, offsetTop: 0, addEventListener() {}},
  addEventListener() {},
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = {now: () => 0};

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.isConnected = true;
  }
  set innerHTML(html) {
    this._html = html;
    this.children = [];
    if (html.includes('class="dice-heading"')) {
      const heading = new MockElement('div');
      heading.className = 'dice-heading';
      heading.append(new MockElement('div'), Object.assign(new MockElement('button'), {className: 'dice-skip'}));
      heading.querySelector = (sel) => sel === 'small' || sel === 'strong' ? new MockElement(sel) : heading.children.find(c => c.tagName === 'BUTTON') ?? null;
      this.append(heading);
    }
    if (html.includes('<canvas')) this.append(new MockElement('canvas'));
    if (html.includes('class="dice-tallies"')) {
      const tallies = new MockElement('div');
      tallies.className = 'dice-tallies';
      this.append(tallies);
    }
  }
  get innerHTML() { return this._html || ''; }
  append(...nodes) {
    for (const node of nodes) { node.parentElement = this; this.children.push(node); }
  }
  remove() {}
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  querySelector(selector) {
    if (selector === 'button' || selector === 'canvas') return this.children.find(c => c.tagName === selector.toUpperCase())
      ?? this.children.flatMap(c => c.children).find(c => c.tagName === selector.toUpperCase())
      ?? null;
    if (selector.startsWith('.') && this.className.includes(selector.slice(1))) return this;
    for (const child of this.children) {
      const match = child.querySelector?.(selector);
      if (match) return match;
      if (selector.startsWith('.') && child.className.includes(selector.slice(1))) return child;
    }
    return null;
  }
  getBoundingClientRect() { return {left: 0, top: 0, width: 100, height: 40, bottom: 40, right: 100}; }
}
globalThis.document = {
  createElement: (tag) => new MockElement(tag),
  body: new MockElement('body'),
  querySelector: () => null,
};

assert.equal(localStorage.getItem('wayfarer-dice-fx'), 'on');

const live = createCombatCues();
assert.equal(live.diceEnabled, true, 'live cues respect saved preference');

const quiet = createCombatCues({skipDice: true});
assert.equal(quiet.diceEnabled, false, 'skipDice reports dice off');
assert.equal(localStorage.getItem('wayfarer-dice-fx'), 'on', 'skipDice does not write localStorage');

live.toggleDice();
assert.equal(localStorage.getItem('wayfarer-dice-fx'), 'off', 'explicit toggle still persists');
live.toggleDice();
assert.equal(localStorage.getItem('wayfarer-dice-fx'), 'on');

const previewSource = await readFile(new URL('../dist/spell-rule-preview.mjs', import.meta.url), 'utf8');
assert.match(previewSource, /createCombatCues\(\{\s*skipDice:\s*true\s*\}\)/, 'preview constructs cues with skipDice');
assert.doesNotMatch(previewSource, /toggleDice\(\)/, 'preview no longer calls toggleDice');

console.log('Spell preview dice preference isolation verified.');
