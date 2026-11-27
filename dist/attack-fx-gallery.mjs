import {attackAnimationCatalog} from './attack-visuals.mjs';
import {escape} from './format.mjs';

const groupLabels = {
  melee: 'Melee',
  ranged: 'Ranged / thrown video',
  special: 'Special',
  drawn: 'Drawn projectile',
};

const motionLabels = {
  swing: 'Swing',
  projectile: 'Projectile',
  impact: 'Impact',
  'drawn-projectile': 'Drawn projectile',
};

function clipBlend(url) {
  if (!url) return '';
  // Catalogue BLFX clips are alpha WebMs, but Chromium's hardware <video> layer
  // often drops alpha and paints the RGB plate (TV-static look). Prefer canvas
  // compositing in this gallery; screen-blend remains a board/game fallback.
  if (/combat-arrow|combat-dagger|combat-greataxe|combat-greatsword|combat-greatclub|combat-glaive|combat-halberd|combat-spikes|combat-unarmed|combat-astral-arms|blfx-/i.test(url)) return 'alpha';
  if (/flame|fire|tentacle/i.test(url)) return 'screen';
  return 'screen';
}

function cacheBust(url) {
  // credits sha changes whenever we re-key; keep previews from sticky-caching.
  return url + (url.includes('?') ? '&' : '?') + 'v=blfx3';
}

function sourceTag(entry) {
  if (entry.group === 'drawn') return 'Drawn';
  if (/combat-arrow|combat-dagger|combat-greataxe|combat-greatsword|combat-greatclub|combat-glaive|combat-halberd|combat-spikes|combat-unarmed|combat-astral-arms/i.test(entry.id)) return 'BLFX';
  return 'JB2A';
}

export function mountAttackFxGallery(host) {
  const entries = attackAnimationCatalog();
  let query = '';
  let group = 'all';
  let view = 'browse';
  let selected = entries.find(entry => entry.url) ?? entries[0] ?? null;
  let previewVideo;
  let previewRaf = 0;

  function matches() {
    const needle = query.trim().toLowerCase();
    return entries.filter(entry => {
      if (group !== 'all' && entry.group !== group) return false;
      if (!needle) return true;
      const hay = [entry.name, entry.id, entry.note, ...(entry.weapons ?? [])].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }

  function stopPreview() {
    if (previewRaf) {
      cancelAnimationFrame(previewRaf);
      previewRaf = 0;
    }
    if (!previewVideo) return;
    previewVideo.pause();
    previewVideo.removeAttribute('src');
    previewVideo.load();
    previewVideo = null;
  }

  /** Hardware <video> often drops WebM alpha; draw frames to canvas so alpha composites. */
  function mountAlphaPreview(stage, url, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'atk-alpha-preview' + (opts.compact ? ' atk-alpha-preview-compact' : '');
    const canvas = document.createElement('canvas');
    canvas.className = 'atk-alpha-canvas' + (opts.projectile ? ' atk-projectile' : '');
    if (opts.flip) canvas.style.transform = 'scaleX(-1)';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = 'auto';
    video.src = cacheBust(url);
    video.setAttribute('aria-hidden', 'true');
    wrap.append(canvas, video);
    stage.append(wrap);

    const draw = () => {
      if (!previewVideo || previewVideo !== video) return;
      if (video.videoWidth && video.videoHeight) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0);
      }
      previewRaf = requestAnimationFrame(draw);
    };

    video.addEventListener('error', () => {
      wrap.replaceChildren();
      const err = document.createElement('p');
      err.className = 'atk-drawn-note';
      err.textContent = 'This animation could not be loaded.';
      wrap.append(err);
    }, {once: true});
    const start = () => {
      canvas.width = video.videoWidth || 600;
      canvas.height = video.videoHeight || 600;
      void video.play().catch(() => {});
      if (!previewRaf) previewRaf = requestAnimationFrame(draw);
    };
    video.addEventListener('loadeddata', start, {once: true});
    video.addEventListener('canplay', start, {once: true});

    previewVideo = video;
    return video;
  }

  function playSelected() {
    const stage = host.querySelector('.fx-preview-stage');
    const note = host.querySelector('.fx-preview-note');
    if (!stage || !selected) return;
    stopPreview();
    stage.replaceChildren();
    if (selected.url) {
      const blend = clipBlend(selected.url);
      if (blend === 'alpha') {
        mountAlphaPreview(stage, selected.url, {
          projectile: /arrow|bolt|throw-dagger/i.test(selected.url),
          flip: selected.flip,
        });
      } else {
        const video = document.createElement('video');
        video.src = cacheBust(selected.url);
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        video.controls = true;
        video.preload = 'metadata';
        if (blend) video.dataset.blend = blend;
        if (selected.flip) video.style.transform = 'scaleX(-1)';
        if (/arrow|bolt|throw-dagger/i.test(selected.url)) video.classList.add('atk-projectile');
        video.addEventListener('error', () => {
          if (note) note.textContent = 'This animation could not be loaded.';
        }, {once: true});
        stage.append(video);
        previewVideo = video;
        void video.play().catch(() => {});
      }
      if (note) {
        note.textContent = selected.id + '.webm · ' + (motionLabels[selected.motion] || selected.motion)
          + (selected.flip ? ' · mirrored' : '')
          + (selected.range ? ' · ≤' + selected.range + ' ft' : '');
      }
      return;
    }
    const empty = document.createElement('p');
    empty.className = 'atk-drawn-note';
    empty.textContent = selected.note || 'Board-drawn projectile — no video clip.';
    stage.append(empty);
    if (note) note.textContent = 'No combat-*.webm for this thrown weapon; combat draws a projectile glyph.';
  }

  function listHtml(list) {
    if (!list.length) return '<p class="fx-empty">No matching attack clips.</p>';
    return list.map(entry => {
      const active = selected?.clipKey === entry.clipKey;
      const tags = [groupLabels[entry.group] || entry.group, sourceTag(entry), motionLabels[entry.motion] || entry.motion];
      if (entry.range) tags.push(entry.range + ' ft');
      return `<button type="button" class="fx-spell-item" data-atk-select="${escape(entry.clipKey)}" aria-pressed="${active}">
        <strong>${escape(entry.name)}</strong>
        <span class="rule-tags">${tags.map(tag => `<span class="rule-tag">${escape(tag)}</span>`).join('')}</span>
        <small>${escape((entry.weapons || []).join(', '))}</small>
      </button>`;
    }).join('');
  }

  function detailHtml(entry) {
    if (!entry) return '<p>No attack animations are registered.</p>';
    const kind = entry.url ? 'video' : 'none';
    return `<header class="rule-selected-heading"><div>
      <h2>${escape(entry.name)}</h2>
      <p>${escape(groupLabels[entry.group] || entry.group)} · ${escape(motionLabels[entry.motion] || entry.motion)} · <code>${escape(entry.id)}</code></p>
    </div>
    <span class="fx-kind-badge fx-kind-${kind}">${escape(sourceTag(entry))}</span></header>
    <dl class="fx-facts">
      <div><dt>Weapons that resolve here</dt><dd>${escape((entry.weapons || []).join(', ') || '—')}</dd></div>
      <div><dt>Clip</dt><dd>${entry.url ? `<code>${escape(entry.url)}</code>` : 'None (drawn on board)'}</dd></div>
      <div><dt>Notes</dt><dd>${escape(entry.note || '—')}</dd></div>
    </dl>
    <fieldset class="fx-preview-panel"><legend>Animation preview</legend>
      <p>Weapon attack clips from <a href="https://jb2a.com/" target="_blank" rel="noopener">JB2A</a> and Boss Loot BLFX Pack 01. <a href="/assets/animations/credits.json" target="_blank" rel="noopener">Sources and credits</a>.</p>
      <div class="fx-preview-toolbar">
        <button type="button" class="button primary small" data-atk-action="play"${kind === 'none' ? ' disabled' : ''}>Play animation</button>
        <button type="button" class="button outline small" data-atk-action="stop">Stop</button>
      </div>
      <div class="fx-preview-stage" aria-live="polite"></div>
      <p class="fx-preview-note" role="status"></p>
    </fieldset>`;
  }

  function gridHtml(list) {
    if (!list.length) return '<p class="fx-empty">No matching attack clips.</p>';
    return `<div class="atk-grid">${list.map(entry => {
      const active = selected?.clipKey === entry.clipKey;
      return `<button type="button" class="atk-tile" data-atk-select="${escape(entry.clipKey)}" aria-pressed="${active}">
        <div class="atk-tile-stage" data-atk-stage="${escape(entry.clipKey)}"></div>
        <strong>${escape(entry.name)}</strong>
        <small>${escape(sourceTag(entry))} · ${escape((entry.weapons || []).slice(0, 4).join(', '))}${(entry.weapons || []).length > 4 ? '…' : ''}</small>
      </button>`;
    }).join('')}</div>`;
  }

  function fillGridVideos(list) {
    for (const entry of list) {
      const stage = host.querySelector(`[data-atk-stage="${CSS.escape(entry.clipKey)}"]`);
      if (!stage) continue;
      stage.replaceChildren();
      if (!entry.url) {
        const note = document.createElement('p');
        note.className = 'atk-drawn-note';
        note.textContent = 'Drawn';
        stage.append(note);
        continue;
      }
      const blend = clipBlend(entry.url);
      const video = document.createElement('video');
      video.src = cacheBust(entry.url);
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.controls = false;
      video.preload = 'auto';
      // Grid keeps <video>+screen blend (many canvases would be heavy).
      video.dataset.blend = blend === 'alpha' ? 'screen' : (blend || 'screen');
      if (entry.flip) video.style.transform = 'scaleX(-1)';
      stage.append(video);
      void video.play().catch(() => {});
    }
  }

  function render() {
    const list = matches();
    if (selected && !list.some(entry => entry.clipKey === selected.clipKey)) selected = list[0] ?? null;
    const videoCount = entries.filter(entry => entry.url).length;
    const drawnCount = entries.length - videoCount;
    const counts = Object.fromEntries(Object.keys(groupLabels).map(key => [key, entries.filter(entry => entry.group === key).length]));

    host.innerHTML = `<section class="spell-fx-desk spell-rule-desk attack-fx-desk" aria-label="Attack FX preview gallery">
      <header class="rule-page-heading"><div>
        <h1>Attack FX preview</h1>
        <p>Every weapon attack animation Wayfarer resolves — melee swings, bow/crossbow/dagger ranges, specials, and board-drawn thrown glyphs. Local only; not published.</p>
      </div></header>
      <div class="atk-view-toggle" role="group" aria-label="View mode">
        <button type="button" class="button ${view === 'browse' ? 'primary' : 'outline'} small" data-atk-view="browse">Browse + preview</button>
        <button type="button" class="button ${view === 'grid' ? 'primary' : 'outline'} small" data-atk-view="grid">All animations grid</button>
      </div>
      ${view === 'grid' ? `
        <label>Search<input class="fx-search" type="search" value="${escape(query)}" placeholder="Weapon or clip"></label>
        <label>Group<select class="fx-group">${[['all', 'All groups'], ...Object.entries(groupLabels).map(([value, label]) => [value, label + ' (' + counts[value] + ')'])].map(([value, label]) =>
          `<option value="${escape(value)}"${group === value ? ' selected' : ''}>${escape(label)}</option>`).join('')}</select></label>
        <p class="rule-search-count">${list.length} shown · ${entries.length} attacks · ${videoCount} video · ${drawnCount} drawn</p>
        ${gridHtml(list)}
      ` : `
      <div class="rule-workspace fx-workspace">
        <aside class="rule-library fx-library" aria-label="Attack animations">
          <label>Search<input class="fx-search" type="search" value="${escape(query)}" placeholder="Weapon or clip"></label>
          <label>Group<select class="fx-group">${[['all', 'All groups'], ...Object.entries(groupLabels).map(([value, label]) => [value, label + ' (' + counts[value] + ')'])].map(([value, label]) =>
            `<option value="${escape(value)}"${group === value ? ' selected' : ''}>${escape(label)}</option>`).join('')}</select></label>
          <p class="rule-search-count">${list.length} shown · ${entries.length} attacks · ${videoCount} video · ${drawnCount} drawn</p>
          <div class="rule-spell-list fx-spell-list">${listHtml(list)}</div>
        </aside>
        <div class="rule-editor-main fx-detail">${detailHtml(selected)}</div>
      </div>`}
    </section>`;

    if (view === 'grid') fillGridVideos(list);
    else if (selected) playSelected();
  }

  host.addEventListener('input', event => {
    if (!event.target.matches('.fx-search')) return;
    query = event.target.value;
    if (view === 'grid') {
      render();
      return;
    }
    const list = host.querySelector('.fx-spell-list');
    const count = host.querySelector('.rule-search-count');
    const filtered = matches();
    if (selected && !filtered.some(entry => entry.clipKey === selected.clipKey)) {
      selected = filtered[0] ?? null;
      const detail = host.querySelector('.fx-detail');
      if (detail) detail.innerHTML = detailHtml(selected);
      if (selected) playSelected();
      else stopPreview();
    }
    if (list) list.innerHTML = listHtml(filtered);
    if (count) {
      const videoCount = entries.filter(entry => entry.url).length;
      const drawnCount = entries.length - videoCount;
      count.textContent = `${filtered.length} shown · ${entries.length} attacks · ${videoCount} video · ${drawnCount} drawn`;
    }
  });

  host.addEventListener('change', event => {
    if (event.target.matches('.fx-group')) {
      group = event.target.value;
      render();
    }
  });

  host.addEventListener('click', event => {
    const viewBtn = event.target.closest('[data-atk-view]');
    if (viewBtn) {
      view = viewBtn.dataset.atkView;
      stopPreview();
      render();
      return;
    }
    const pick = event.target.closest('[data-atk-select]');
    if (pick) {
      selected = entries.find(entry => entry.clipKey === pick.dataset.atkSelect) ?? null;
      if (view === 'grid') {
        // Keep grid, but also jump to browse detail for a larger preview.
        view = 'browse';
      }
      render();
      host.querySelector(`[data-atk-select="${CSS.escape(pick.dataset.atkSelect)}"]`)?.focus();
      return;
    }
    const action = event.target.closest('[data-atk-action]')?.dataset.atkAction;
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
