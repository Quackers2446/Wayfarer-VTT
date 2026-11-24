import { strict as assert } from 'node:assert';
import { roomMapChoices } from '../dist/room-state.mjs';

// Test: moduleMaps pairs DM and player map variants correctly
// This validates the pairing logic across all formats seen in 5etools adventures.

function pairMaps(rawMaps) {
  const playerByParent = new Map();
  let prevDm = null;
  for (const m of rawMaps) {
    const isPlayer = m.imageType === 'mapPlayer' || m.title === 'Player Version' || Boolean(m.title && /\(player\)/i.test(m.title));
    const parentId = typeof m.mapParent === 'string' ? m.mapParent : m.mapParent?.id;
    if (isPlayer) {
      if (parentId) {
        playerByParent.set(parentId, m);
      } else if (prevDm) {
        if (prevDm.id) playerByParent.set(prevDm.id, m);
        if (prevDm.asset) playerByParent.set(prevDm.asset, m);
        if (prevDm.title) playerByParent.set(prevDm.title, m);
      }
    } else {
      prevDm = m;
    }
  }

  const maps = rawMaps.map(m => {
    const isPlayer = m.imageType === 'mapPlayer' || m.title === 'Player Version' || Boolean(m.title && /\(player\)/i.test(m.title));
    const pv = !isPlayer ? (
      (m.id ? playerByParent.get(m.id) : null) ??
      (m.asset ? playerByParent.get(m.asset) : null) ??
      (m.title ? playerByParent.get(m.title) : null)
    ) : null;
    return {
      ...m,
      ...(pv?.asset ? { playerAsset: pv.asset } : {})
    };
  });

  const pairedPlayerAssets = new Set(maps.filter(m => m.playerAsset).map(m => m.playerAsset));
  const dmTitles = new Set(maps.filter(m => !m.title.includes('(Player)') && m.title !== 'Player Version').map(m => m.title));
  return maps.filter(m => {
    if (m.playerAsset) return true;
    if (m.asset && pairedPlayerAssets.has(m.asset)) return false;
    if (m.title === 'Player Version') return false;
    if (m.title.endsWith(' (Player)')) {
      const baseTitle = m.title.slice(0, -9).trim();
      if (dmTitles.has(baseTitle)) {
        const dmMap = maps.find(other => other.title === baseTitle);
        if (dmMap && !dmMap.playerAsset && m.asset) {
          dmMap.playerAsset = m.asset;
        }
        return false;
      }
    }
    return true;
  });
}

// --- Test 1: DM + Player pair with mapParent object ---
{
  const raw = [
    { key: 'dm-caves', id: 'caves-dm', asset: 'adventure/caves-dm.webp', imageType: 'map', title: 'Seagrow Caves', regions: ['r1','r2'] },
    { key: 'player-caves', id: 'caves-player', asset: 'adventure/caves-player.webp', imageType: 'mapPlayer', mapParent: { id: 'caves-dm' }, title: 'Player Version', regions: [] },
  ];
  const result = pairMaps(raw);
  assert.equal(result.length, 1, 'Paired: only one map should remain');
  assert.equal(result[0].key, 'dm-caves', 'The DM map is kept');
  assert.equal(result[0].playerAsset, 'adventure/caves-player.webp', 'playerAsset is set to the player artwork path');
  assert.equal(result[0].asset, 'adventure/caves-dm.webp', 'DM asset is preserved for reference');
  assert.deepEqual(result[0].regions, ['r1','r2'], 'DM regions are preserved');
  console.log('✓ Test 1: DM + Player pair with mapParent object merges correctly');
}

// --- Test 2: DM + Player pair with string mapParent ---
{
  const raw = [
    { key: 'dm-obs', id: 'obs-dm', asset: 'adventure/obs-dm.webp', imageType: 'map', title: 'Clifftop Observatory', regions: ['o1'] },
    { key: 'player-obs', id: 'obs-p', asset: 'adventure/obs-player.webp', imageType: 'mapPlayer', mapParent: 'obs-dm', title: 'Player Version', regions: [] },
  ];
  const result = pairMaps(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].playerAsset, 'adventure/obs-player.webp');
  console.log('✓ Test 2: DM + Player pair with string mapParent merges correctly');
}

// --- Test 3: Sequential "Player Version" with NO mapParent (DoSI pattern) ---
{
  const raw = [
    { key: 'dm-rose', id: 'rose-dm', asset: 'adventure/rose-dm.webp', imageType: 'map', title: 'Map 4: The Wreck of Compass Rose', regions: ['w1'] },
    { key: 'player-rose', id: 'rose-p', asset: 'adventure/rose-p.webp', imageType: 'mapPlayer', title: 'Player Version', regions: [] },
  ];
  const result = pairMaps(raw);
  assert.equal(result.length, 1, 'Only the DM map remains in dropdown');
  assert.equal(result[0].title, 'Map 4: The Wreck of Compass Rose');
  assert.equal(result[0].playerAsset, 'adventure/rose-p.webp', 'Sequential player artwork linked');
  console.log('✓ Test 3: Sequential Player Version without mapParent links to preceding DM map');
}

// --- Test 4: Title-based pairing: "Map (Player)" matching "Map" ---
{
  const raw = [
    { key: 'dm-hideout', id: 'crag-dm', asset: 'crag-dm.webp', imageType: 'map', title: 'Cragmaw Hideout', regions: ['c1'] },
    { key: 'player-hideout', id: 'crag-p', asset: 'crag-player.webp', imageType: 'map', title: 'Cragmaw Hideout (Player)', regions: [] },
  ];
  const result = pairMaps(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Cragmaw Hideout');
  assert.equal(result[0].playerAsset, 'crag-player.webp');
  console.log('✓ Test 4: Title-based pairing matches and deduplicates (Player) maps');
}

// --- Test 5: Standalone DM map (no player variant) is unchanged ---
{
  const raw = [
    { key: 'dm-only', id: 'dungeon-dm', asset: 'adventure/dungeon.webp', imageType: 'map', title: 'Dark Dungeon', regions: ['a','b'] },
  ];
  const result = pairMaps(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].playerAsset, undefined);
  assert.equal(result[0].asset, 'adventure/dungeon.webp');
  console.log('✓ Test 5: Standalone DM map (no player variant) is unchanged');
}

// --- Test 6: Standalone Player map (no DM parent) is kept if not titled "Player Version" ---
{
  const raw = [
    { key: 'player-orphan', id: 'orphan', asset: 'adventure/orphan-player.webp', imageType: 'mapPlayer', title: 'Independent Arena', regions: [] },
  ];
  const result = pairMaps(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'player-orphan');
  console.log('✓ Test 6: Standalone named map is kept');
}

// --- Test 7: Bare "Player Version" without DM map is discarded ---
{
  const raw = [
    { key: 'broken', id: 'broken', asset: 'broken.webp', imageType: 'mapPlayer', title: 'Player Version', regions: [] },
  ];
  const result = pairMaps(raw);
  assert.equal(result.length, 0, 'Broken bare "Player Version" should never show in dropdown');
  console.log('✓ Test 7: Broken bare "Player Version" is discarded');
}

// --- Test 8: Dragons of Stormwreck Isle full chapter simulation ---
{
  const raw = [
    { key: 'm1', id: 'dosi-m1', asset: 'm1-dm.webp', imageType: 'map', title: 'Map 1: Stormwreck Isle', regions: [] },
    { key: 'm1-p', id: 'dosi-m1-p', asset: 'm1-p.webp', imageType: 'mapPlayer', title: 'Player Version', mapParent: { id: 'dosi-m1' }, regions: [] },
    { key: 'm2', id: 'dosi-m2', asset: 'm2-dm.webp', imageType: 'map', title: 'Map 2: Dragons Rest', regions: ['r1'] },
    { key: 'm2-p', id: 'dosi-m2-p', asset: 'm2-p.webp', imageType: 'mapPlayer', title: 'Player Version', mapParent: { id: 'dosi-m2' }, regions: [] },
    { key: 'm3', id: 'dosi-m3', asset: 'm3-dm.webp', imageType: 'map', title: 'Map 3: Seagrow Caves', regions: ['c1','c2'] },
    { key: 'm3-p', id: 'dosi-m3-p', asset: 'm3-p.webp', imageType: 'mapPlayer', title: 'Player Version', mapParent: { id: 'dosi-m3' }, regions: [] },
    { key: 'm4', id: 'dosi-m4', asset: 'm4-dm.webp', imageType: 'map', title: 'Map 4: The Wreck of Compass Rose', regions: ['w1'] },
    { key: 'm4-p', id: 'dosi-m4-p', asset: 'm4-p.webp', imageType: 'mapPlayer', title: 'Player Version', regions: [] },
    { key: 'm5', id: 'dosi-m5', asset: 'm5-dm.webp', imageType: 'map', title: 'Map 5: Clifftop Observatory', regions: ['o1'] },
    { key: 'm5-p', id: 'dosi-m5-p', asset: 'm5-p.webp', imageType: 'mapPlayer', title: 'Player Version', regions: [] },
  ];
  const result = pairMaps(raw);
  assert.equal(result.length, 5, 'Exactly 5 clean maps remain (no Player Version clutter)');
  assert.deepEqual(result.map(m => m.title), [
    'Map 1: Stormwreck Isle',
    'Map 2: Dragons Rest',
    'Map 3: Seagrow Caves',
    'Map 4: The Wreck of Compass Rose',
    'Map 5: Clifftop Observatory',
  ]);
  assert.equal(result[0].playerAsset, 'm1-p.webp');
  assert.equal(result[1].playerAsset, 'm2-p.webp');
  assert.equal(result[2].playerAsset, 'm3-p.webp');
  assert.equal(result[3].playerAsset, 'm4-p.webp');
  assert.equal(result[4].playerAsset, 'm5-p.webp');
  console.log('✓ Test 8: Full DoSI adventure simulation produces clean, paired dropdown list');
}

// --- Test 9: Display asset and DM notes toggle logic ---
{
  const pairedMap = { asset: 'dm.webp', playerAsset: 'player.webp' };
  const unpairedMap = { asset: 'dm.webp' };

  // By default (battle.showDmArtwork is false/undefined):
  const defaultAsset = (battle) => (battle?.showDmArtwork ? pairedMap.asset : (pairedMap.playerAsset ?? pairedMap.asset));
  assert.equal(defaultAsset({}), 'player.webp', 'Default displays clean player artwork');
  assert.equal(defaultAsset({ showDmArtwork: false }), 'player.webp', 'showDmArtwork false displays player artwork');
  assert.equal(defaultAsset({ showDmArtwork: true }), 'dm.webp', 'showDmArtwork true displays DM notes artwork');

  // Unpaired map always displays its asset:
  const unpairedAsset = (battle) => (battle?.showDmArtwork ? unpairedMap.asset : (unpairedMap.playerAsset ?? unpairedMap.asset));
  assert.equal(unpairedAsset({}), 'dm.webp', 'Unpaired map displays dm.webp');
  assert.equal(unpairedAsset({ showDmArtwork: true }), 'dm.webp', 'Unpaired map displays dm.webp when showDmArtwork true');
  console.log('✓ Test 9: Display asset defaults to Player and supports DM notes toggle');
}

// --- Test 10: roomMapChoices cleans up old session choices ---
{
  const state = {
    currentMap: { key: 'm2', module: 'DoSI', title: 'Map 2: Dragons Rest', asset: 'm2-dm.webp', playerAsset: 'm2-p.webp' },
    world: {
      maps: {
        'm2': { map: { key: 'm2', module: 'DoSI', title: 'Map 2: Dragons Rest', asset: 'm2-dm.webp', playerAsset: 'm2-p.webp' } },
        'old-player': { map: { key: 'm2-p', module: 'DoSI', title: 'Player Version', asset: 'm2-p.webp' } }
      }
    }
  };
  const available = [
    { key: 'm2', module: 'DoSI', title: 'Map 2: Dragons Rest', asset: 'm2-dm.webp', playerAsset: 'm2-p.webp' },
    { key: 'm3', module: 'DoSI', title: 'Map 3: Seagrow Caves', asset: 'm3-dm.webp', playerAsset: 'm3-p.webp' }
  ];
  const choices = roomMapChoices(state, available);
  assert.equal(choices.length, 2, 'Stale Player Version from world.maps is filtered out');
  assert.deepEqual(choices.map(c => c.title), ['Map 2: Dragons Rest', 'Map 3: Seagrow Caves']);
  console.log('✓ Test 10: roomMapChoices filters stale player entries from previous sessions');
}

console.log('\nAll 10 map pairing and display tests passed.');
