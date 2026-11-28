import assert from 'node:assert/strict';
import {spokenLines} from '../dist/speech-bubbles.mjs';

assert.deepEqual(
  spokenLines([
    'Durnan polishes a mug and sizes you up.',
    '"Party went missing on the Triboar Trail."',
  ]),
  ['Party went missing on the Triboar Trail.']
);
assert.deepEqual(
  spokenLines(['Durnan nods. "You look like you\'ve earned a drink."']),
  ['You look like you\'ve earned a drink.']
);
assert.deepEqual(spokenLines(['No quotes here, just narration.']), ['No quotes here, just narration.']);
assert.deepEqual(spokenLines([]), []);

console.log('Speech bubble line picking: quoted dialogue preferred, narration fallback verified.');
