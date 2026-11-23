import assert from 'node:assert/strict';
import {createCombatCues, cueDuration} from '../dist/combat-cues.mjs';

console.log('Testing concurrent combat cues and rapid dice execution...');

// Setup a mock DOM environment
const mockElements = new Set();
class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {
      setProperty: (k, v) => { this.style[k] = v; }
    };
    this.dataset = {};
    this.className = '';
    this.offsetWidth = 220;
    this.offsetHeight = 80;
    this.isConnected = true;
    this._listeners = {};
    mockElements.add(this);
  }
  set innerHTML(html) {
    this._html = html;
    if (html.includes('<button')) this.append(new MockElement('button'));
    if (html.includes('<canvas')) this.append(new MockElement('canvas'));
    if (html.includes('class="dice-tallies"')) {
      const el = new MockElement('div');
      el.className = 'dice-tallies';
      this.append(el);
    }
    if (html.includes('class="dice-heading"')) {
      const el = new MockElement('div');
      el.className = 'dice-heading';
      const sm = new MockElement('small');
      const st = new MockElement('strong');
      const dv = new MockElement('div');
      dv.append(sm, st);
      const btn = new MockElement('button');
      btn.className = 'dice-skip';
      el.append(dv, btn);
      this.append(el);
    }
  }
  get innerHTML() {
    return this._html || '';
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) {
        node.parentElement.removeChild(node);
      }
      node.parentElement = this;
      this.children.push(node);
    }
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }
  removeChild(node) {
    const idx = this.children.indexOf(node);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      node.parentElement = null;
    }
  }
  replaceChildren(...nodes) {
    while (this.children.length) this.removeChild(this.children[0]);
    this.append(...nodes);
  }
  addEventListener(event, fn) {
    (this._listeners[event] ??= []).push(fn);
  }
  removeEventListener(event, fn) {
    const arr = this._listeners[event];
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
  }
  dispatchEvent(event) {
    const listeners = this._listeners[event.type] ?? [];
    for (const fn of listeners) fn(event);
  }
  closest(selector) {
    if (selector.startsWith('.') && this.className.includes(selector.slice(1))) return this;
    if (selector.startsWith('#') && this.id === selector.slice(1)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  querySelector(selector) {
    if (selector.startsWith('.') && this.className.includes(selector.slice(1))) return this;
    if (this.tagName.toLowerCase() === selector.toLowerCase()) return this;
    for (const child of this.children) {
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
  querySelectorAll(selector) {
    return this.children.filter(c => (selector.startsWith('.') && c.className.includes(selector.slice(1))));
  }
  getBoundingClientRect() {
    return {
      left: 100,
      top: 100,
      right: 900,
      bottom: 700,
      width: 800,
      height: 600
    };
  }
  animate() {
    return {cancel() {}};
  }
  getAnimations() {
    return [];
  }
  setAttribute(k, v) {
    this[k] = v;
  }
}

globalThis.document = {
  createElement: tag => new MockElement(tag),
  body: new MockElement('body'),
  querySelector: () => null
};
globalThis.window = {
  visualViewport: {width: 1200, height: 800, offsetLeft: 0, offsetTop: 0, addEventListener: () => {}},
  addEventListener: () => {}
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({matches: false});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Create cues manager
const combatCues = createCombatCues();

const layer = new MockElement('div');
const frame = new MockElement('div');
const grid = new MockElement('div');
const map = {cols: 20, rows: 20, size: 40, width: 800, height: 800};
const sight = new Set(['5:5', '6:6']);

const viewport = {
  layer,
  frame,
  grid,
  map,
  sight,
  fogEnabled: false,
  feed: new MockElement('div'),
  motion: {remaining: () => 0}
};

// Test 1: Non-dice events reveal immediately and multiple can co-exist
const event1 = {
  id: 1,
  actor: 'hero-1',
  name: 'Hero',
  action: 'Second Wind',
  kind: 'heal',
  x: 5,
  y: 5,
  visible: true,
  messages: ['Healed 12 HP']
};
const event2 = {
  id: 2,
  actor: 'hero-1',
  name: 'Hero',
  action: 'Action Surge',
  kind: 'ability',
  x: 5,
  y: 5,
  visible: true,
  messages: ['Extra action gained']
};

// Initialize scope
combatCues.sync('battle-1', [], viewport);

// Fresh events arriving in battle
combatCues.sync('battle-1', [event1, event2], viewport);

// Both cue elements should be created and in the layer at the same time
const cueElements = layer.children.filter(c => c.className.includes('combat-cue'));
assert.equal(cueElements.length, 2, 'Both non-dice cues appear simultaneously in the layer');

// Check that anti-overlap offset has positioned them differently (not identical top/left)
assert.notEqual(
  cueElements[0].style.top,
  cueElements[1].style.top,
  'Anti-overlap layout stacks or separates cues for the same actor'
);

// Test 2: Dismissing one cue removes only that specific cue
cueElements[0].dispatchEvent({type: 'click', stopPropagation: () => {}, target: {closest: sel => sel === '.cue-dismiss'}});
const remainingCues = layer.children.filter(c => c.className.includes('combat-cue'));
assert.equal(remainingCues.length, 1, 'Dismissing first cue leaves second cue intact');

// Test 3: Cue duration validation
assert.ok(cueDuration({outcome: 'Hit', side: 'party'}) > cueDuration({outcome: 'Hit', side: 'hostile'}));
assert.equal(cueDuration({kind: 'move'}), 0);

console.log('Concurrent cues and anti-overlap tests passed successfully!');
