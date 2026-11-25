import {applyHestiasFury} from './hestias-fury.mjs';
import {normalizeRoomState} from './room-state.mjs';

// Append migrations in order. Each migration must preserve room progress and explicit rules.
const migrations = [
  (state) => { state.battle.actors.forEach(applyHestiasFury); },
];

export function upgradeRoomState(state, map, {hasArtwork = false} = {}) {
  const version = Number.isSafeInteger(state.roomDataVersion) && state.roomDataVersion > 0 ? state.roomDataVersion : 0;
  if (version >= migrations.length) return state;
  const next = normalizeRoomState(structuredClone(state), state.currentMap ?? map);
  if (hasArtwork && !next.artworkMapKey) next.artworkMapKey = (map ?? next.currentMap).key;
  for (const migrate of migrations.slice(version)) migrate(next);
  next.roomDataVersion = migrations.length;
  return next;
}

// Every write uses the revision we read. Recompute on a newer snapshot rather
// than writing a migration over another player's move, roll, or edit.
export async function upgradeOpenedRoom(snapshot, write, isCurrent = () => true) {
  let latest = snapshot;
  for (let attempt = 0; attempt < 2 && isCurrent(); attempt++) {
    try {
      const state = upgradeRoomState(latest.state, latest.map, {hasArtwork:latest.hasArtwork});
      if (state === latest.state) return latest;
      const result = await write(latest.revision, state);
      if (!result.state) return {...latest, state, revision:result.revision};
      latest = {...latest, ...result};
    } catch (error) {
      if (error.status === 404) throw error;
      // The supported runtime can still open a save when the upgrade write fails.
      return latest;
    }
  }
  return latest;
}
