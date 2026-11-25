import {drawGrid} from './grid-view.mjs';
import {createCombatCues} from './combat-cues.mjs';
import {customSpellCells} from './custom-spells.mjs';

export const previewMap = Object.freeze({
  cols: 24, rows: 12, size: 25, width: 600, height: 300,
  offsetX: 0, offsetY: 0, regions: [], title: 'Spell test encounter',
});

export function previewCastOptions(rule) {
  const wall = rule.shape === 'wall' || rule.shape === 'line';
  return {
    map: previewMap,
    square: wall ? {x: 8, y: 2} : {x: 9, y: 6},
    end: {x: 8, y: 10},
    hotSide: 'left',
  };
}

/** Private board for the spell-rules desk: same cues, videos, and zone loops as play. */
export function createSpellRulePreview() {
  let cues;
  let frame, grid, canvas, cueLayer, resize;
  let battle = null;
  let map = previewMap;
  let options = {};
  let syncedBattle = null;

  function theatre() {
    if (!cues) {
      // Preview-only quiet mode: skip dice without writing wayfarer-dice-fx.
      cues = createCombatCues({skipDice: true});
    }
    return cues;
  }

  function elements(host) {
    frame = host?.querySelector('.rule-preview-board') ?? null;
    grid = host?.querySelector('.rule-preview-grid') ?? null;
    canvas = host?.querySelector('canvas') ?? null;
    cueLayer = host?.querySelector('.combat-cues') ?? null;
  }

  function viewBox() {
    const width = Math.max(1, grid?.clientWidth || map.width);
    const height = Math.max(1, grid?.clientHeight || map.height);
    return {
      x: 0, y: 0, width, height,
      mapWidth: map.width, mapHeight: map.height,
      ratio: window.devicePixelRatio || 1,
    };
  }

  function cueView() {
    return {
      layer: cueLayer,
      frame,
      grid,
      map,
      battle,
      sight: new Set(),
      fogEnabled: false,
      feed: null,
      onReveal: () => paintBoard(),
    };
  }

  function paintBoard() {
    if (!canvas || !grid || !frame) return;
    const view = viewBox();
    Object.assign(canvas.style, {
      position: 'absolute', left: '0', top: '0',
      width: view.width + 'px', height: view.height + 'px',
    });
    const state = battle ?? {actors: options.actors ?? [], terrain: {}, spellZones: [], markers: []};
    const visible = battle ? new Set(battle.actors.map((actor) => actor.id)) : null;
    drawGrid(canvas, view, map, state, {
      selected: options.selected,
      footprint: options.footprint ?? null,
      showRegions: false,
      fog: null,
      overlay: 'tactical',
      visible,
      markers: [],
    });
  }

  function syncCues() {
    if (!battle || !cueLayer || !frame || !grid) {
      theatre().sync('spell-rule-preview:idle', [], null);
      syncedBattle = null;
      return;
    }
    const view = cueView();
    // New encounter: arm an empty cursor so the cast event actually plays (room joins skip history).
    if (syncedBattle !== battle) {
      theatre().sync(battle, [], view);
      syncedBattle = battle;
    }
    theatre().sync(battle, battle.actionEvents ?? [], view);
  }

  function paint(nextBattle, nextOptions = {}) {
    battle = nextBattle ?? null;
    options = nextOptions;
    map = nextOptions.map ?? previewMap;
    paintBoard();
    syncCues();
  }

  function mount(host, nextBattle, nextOptions = {}) {
    const previous = frame;
    elements(host);
    if (frame !== previous) {
      theatre().reset();
      syncedBattle = null;
      resize?.disconnect();
      if (frame && typeof ResizeObserver === 'function') {
        resize = new ResizeObserver(() => {
          paintBoard();
          theatre().place();
        });
        resize.observe(frame);
      }
    }
    if (!host || !frame) {
      if (!frame) reset();
      return;
    }
    paint(nextBattle, nextOptions);
  }

  function reset() {
    resize?.disconnect();
    resize = null;
    cues?.reset();
    syncedBattle = null;
    elements(null);
    battle = null;
    options = {};
  }

  return {
    mount,
    paint,
    place: () => cues?.place(),
    reset,
    footprintFor(rule, caster = {x: 2, y: 6}) {
      const cast = previewCastOptions(rule);
      return customSpellCells(rule, caster, cast.square, previewMap, cast);
    },
  };
}
