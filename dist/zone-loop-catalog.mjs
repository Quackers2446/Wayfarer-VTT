// Looping overlays for persistent spell zones. Cast cues stay one-shot; these play for the
// lifetime of battle.spellZones. Prefer already-bundled cast/sustain clips; a few Generic
// Loop downloads cover auras and ground zones without a good local sustain.
export const animationSourceRevision = 'e930132102cbfa22a0ba964a3df73feb3412727a';
const gh = (path) => `https://raw.githubusercontent.com/Jules-Bens-Aa/JB2A_DnD5e/${animationSourceRevision}/${path}`;

function clip(id, spells, {kind = 'burst', diameter = 2, length, url, source} = {}) {
  return {
    id,
    spells,
    kind,
    diameter,
    length,
    label: id.replace(/^zone-loop-/, '').replace(/-/g, ' '),
    url: url ?? `/assets/animations/${id}.webm`,
    scale: 1,
    duration: 4000,
    loop: true,
    ...(source ? {source} : {}),
  };
}

// Local cast/sustain clips reused with video.loop while the zone lasts.
export const zoneLoopReuse = [
  clip('zone-loop-wall-of-fire', ['wall of fire'], {
    kind: 'line', length: 12,
    url: '/assets/animations/4th-level-wall-of-fire-walloffire-01-yellow-300x100.webm',
  }),
  clip('zone-loop-wall-of-fire-ring', ['wall of fire'], {
    kind: 'burst', diameter: 4,
    url: '/assets/animations/4th-level-wall-of-fire-walloffire-01-yellow-ring-400x400.webm',
  }),
  clip('zone-loop-flaming-sphere', ['flaming sphere'], {
    kind: 'burst', diameter: 1,
    url: '/assets/animations/2nd-level-flaming-sphere-flamingsphere-02-orange-400x400.webm',
  }),
  clip('zone-loop-moonbeam', ['moonbeam'], {
    kind: 'burst', diameter: 2,
    url: '/assets/animations/2nd-level-moonbeam-moonbeamcomplete-01-regular-blue-400x400.webm',
  }),
  clip('zone-loop-spirit-guardians', ['spirit guardians'], {
    kind: 'burst', diameter: 6,
    url: '/assets/animations/3rd-level-spirit-guardians-spiritguardians-01-light-blueyellow-600x600.webm',
  }),
  clip('zone-loop-darkness', ['darkness', 'hunger of hadar'], {
    kind: 'burst', diameter: 6,
    url: '/assets/animations/2nd-level-darkness-darkness-01-black-600x600.webm',
  }),
  clip('zone-loop-cloud-of-daggers', ['cloud of daggers'], {
    kind: 'burst', diameter: 1,
    url: '/assets/animations/2nd-level-cloud-of-daggers-cloudofdaggers-01-light-orange-400x400.webm',
  }),
  clip('zone-loop-web', ['web'], {
    kind: 'burst', diameter: 4,
    url: '/assets/animations/2nd-level-web-web-01-white-01-400x400.webm',
  }),
  clip('zone-loop-fog-cloud', ['fog cloud'], {
    kind: 'burst', diameter: 8,
    url: '/assets/animations/1st-level-fog-cloud-fogcloud-01-white-800x800.webm',
  }),
  clip('zone-loop-stinking-cloud', ['stinking cloud', 'cloudkill'], {
    kind: 'burst', diameter: 6,
    url: '/assets/animations/spell-fx-fog.webm',
  }),
  clip('zone-loop-grease', ['grease'], {
    kind: 'burst', diameter: 2,
    url: '/assets/animations/1st-level-grease-grease-dark-brown-600x600.webm',
  }),
  clip('zone-loop-sleet-storm', ['sleet storm'], {
    kind: 'burst', diameter: 8,
    url: '/assets/animations/3rd-level-sleet-storm-sleetstorm-01-blue-800x800.webm',
  }),
  clip('zone-loop-ice-storm', ['ice storm'], {
    kind: 'burst', diameter: 4,
    url: '/assets/animations/spell-fx-ice-storm.webm',
  }),
  clip('zone-loop-black-tentacles', ['evards black tentacles'], {
    kind: 'burst', diameter: 4,
    url: '/assets/animations/4th-level-black-tentacles-blacktentacles-01-dark-purple-600x600.webm',
  }),
  clip('zone-loop-wind-wall', ['wind wall'], {
    kind: 'line', length: 10,
    url: '/assets/animations/3rd-level-wind-wall-windwall-01-500x100.webm',
  }),
  clip('zone-loop-entangle', ['entangle'], {
    kind: 'burst', diameter: 4,
    url: '/assets/animations/1st-level-entangle-entangle-01-yellow-400x400.webm',
  }),
  clip('zone-loop-silence', ['silence'], {
    kind: 'burst', diameter: 4,
    url: '/assets/animations/spell-fx-silence.webm',
  }),
  clip('zone-loop-create-bonfire', ['create bonfire'], {
    kind: 'burst', diameter: 1,
    url: '/assets/animations/blfx-fire-impact.webm',
  }),
  clip('zone-loop-dust-devil', ['dust devil'], {
    kind: 'burst', diameter: 1,
    url: '/assets/animations/blfx-wind-aura.webm',
  }),
  clip('zone-loop-healing-spirit', ['healing spirit'], {
    kind: 'burst', diameter: 1,
    url: '/assets/animations/blfx-nature-aura.webm',
  }),
  clip('zone-loop-warding-wind', ['warding wind'], {
    kind: 'burst', diameter: 4,
    url: '/assets/animations/blfx-wind-aura.webm',
  }),
  clip('zone-loop-erupting-earth', ['erupting earth'], {
    kind: 'burst', diameter: 4,
    url: '/assets/animations/blfx-earth-burst.webm',
  }),
  clip('zone-loop-sickening-radiance', ['sickening radiance'], {
    kind: 'burst', diameter: 6,
    url: '/assets/animations/blfx-sacred-flame.webm',
  }),
  clip('zone-loop-storm-sphere', ['storm sphere'], {
    kind: 'burst', diameter: 4,
    url: '/assets/animations/blfx-storm-sphere.webm',
  }),
  clip('zone-loop-dawn', ['dawn'], {
    kind: 'burst', diameter: 12,
    url: '/assets/animations/blfx-sacred-flame.webm',
  }),
  clip('zone-loop-maelstrom', ['maelstrom'], {
    kind: 'burst', diameter: 6,
    url: '/assets/animations/blfx-ice-storm-loop.webm',
  }),
  clip('zone-loop-wall-of-light', ['wall of light'], {
    kind: 'line', length: 12,
    url: '/assets/animations/blfx-wall-light-ring.webm',
  }),
  clip('zone-loop-wall-of-ice', ['wall of ice'], {
    kind: 'line', length: 20,
    url: '/assets/animations/5th-level-wall-of-force-wallofforce-01-grey-h-200x200.webm',
  }),
];

// Fresh Generic Loop downloads for zones that benefit from a true sustain clip.
export const zoneLoopDownloads = [
  clip('zone-loop-vines', ['spike growth', 'insect plague', 'entangle'], {
    diameter: 4,
    source: gh('Library/Generic/Nature/PlantGrowthRoundLoop03_01_Regular_GreenYellow_500x500.webm'),
  }),
  clip('zone-loop-energy-ring', ['circle of power', 'aura of life', 'aura of purity', 'crusaders mantle'], {
    diameter: 6,
    source: gh('Library/Generic/Energy/EnergyWall01_01_Regular_Orange_Circle_Loop_500x500.webm'),
  }),
];

export const zoneLoopCatalog = [...zoneLoopReuse, ...zoneLoopDownloads];
