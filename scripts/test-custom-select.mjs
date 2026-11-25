import assert from 'node:assert/strict';
import {
  findSelect,
  positionMenu,
  nextSelectIndex,
  findOptionByChar,
  buildSelectData
} from '../dist/custom-select.mjs';

// 1. Test nextSelectIndex
const disabled = new Set([1, 3]);
assert.equal(nextSelectIndex(0, 1, 4, disabled), 2, 'Should skip disabled index 1 and advance to 2');
assert.equal(nextSelectIndex(2, 1, 4, disabled), 0, 'Should wrap around from 2, skipping 3, to 0');
assert.equal(nextSelectIndex(0, -1, 4, disabled), 2, 'Should move backwards skipping 3 and 1 to 2');
assert.equal(nextSelectIndex(0, 1, 1, new Set([0])), 0, 'Should stay on 0 if all disabled');

// 2. Test findOptionByChar
const testOptions = [
  { text: 'Inspect room', disabled: false },
  { text: 'Place token', disabled: false },
  { text: 'Difficult terrain', disabled: false },
  { text: 'Clear terrain', disabled: false }
];
assert.equal(findOptionByChar(testOptions, 'p', 0), 1, 'Should find Place token');
assert.equal(findOptionByChar(testOptions, 'd', 0), 2, 'Should find Difficult terrain');
assert.equal(findOptionByChar(testOptions, 'c', 0), 3, 'Should find Clear terrain');
assert.equal(findOptionByChar(testOptions, 'i', 2), 0, 'Should wrap around to find Inspect room');
assert.equal(findOptionByChar(testOptions, 'z', 0), -1, 'Should return -1 for unmatched character');

// 3. Test positionMenu
const anchorRect = { top: 100, bottom: 140, left: 50, right: 250, width: 200, height: 40 };
const viewport = { width: 1200, height: 800 };
const posBelow = positionMenu(anchorRect, viewport, 200, 180);
assert.equal(posBelow.top, 144, 'Should position 4px below anchor when space permits');
assert.equal(posBelow.left, 50, 'Should align with left of anchor');
assert.equal(posBelow.width, 200, 'Should match anchor width');
assert.equal(posBelow.up, false, 'Should not flip up when space is available below');

// Test flipping upwards when near bottom of viewport
const bottomRect = { top: 750, bottom: 790, left: 50, right: 250, width: 200, height: 40 };
const posAbove = positionMenu(bottomRect, viewport, 200, 180);
assert.equal(posAbove.up, true, 'Should flip upwards when cramped below');
assert(posAbove.top < 750, 'Top should be above anchor');

// 4. Test buildSelectData mock
const mockSelect = {
  children: [
    { tagName: 'OPTION', value: 'inspect', text: 'Inspect room', selected: true, disabled: false },
    { tagName: 'OPTION', value: 'token', text: 'Place token', selected: false, disabled: false },
    {
      tagName: 'OPTGROUP',
      label: 'Terrain Tools',
      children: [
        { tagName: 'OPTION', value: 'difficult', text: 'Difficult terrain', selected: false, disabled: false },
        { tagName: 'OPTION', value: 'clear', text: 'Clear terrain', selected: false, disabled: true }
      ]
    }
  ]
};

const data = buildSelectData(mockSelect);
assert.equal(data.options.length, 4, 'Should extract 4 options across flat and optgroup');
assert.equal(data.items.length, 5, 'Should extract 1 group header + 4 options');
assert.equal(data.options[0].value, 'inspect');
assert.equal(data.options[0].selected, true);
assert.equal(data.options[3].disabled, true);
assert.equal(data.items[2].type, 'group');
assert.equal(data.items[2].label, 'Terrain Tools');

console.log('Custom select positioning, keyboard cycling, type-ahead, and option parsing verified successfully.');
