// Accessible, custom-themed select dropdown controller matching Wayfarer's fantasy parchment aesthetic.
// Seamlessly prevents jarring OS native picker popups while maintaining native select value and events.

export function findSelect(target) {
  if (!target || !(target instanceof Element)) return null;
  if (target.tagName === 'SELECT' && !target.multiple) return target;
  const field = target.closest('.select-field');
  if (field) {
    const sel = field.querySelector('select:not([multiple])');
    if (sel) return sel;
  }
  return null;
}

export function positionMenu(anchorRect, viewport, menuHeight, minW = 180) {
  const below = viewport.height - anchorRect.bottom - 8;
  const above = anchorRect.top - 8;
  const height = Math.min(320, menuHeight);
  const up = below < Math.min(height, 180) && above > below;
  const width = Math.min(Math.max(minW, anchorRect.width), viewport.width - 16);
  const left = Math.max(8, Math.min(anchorRect.left, viewport.width - width - 8));
  const top = up ? Math.max(8, anchorRect.top - Math.min(height, above) - 4) : (anchorRect.bottom + 4);
  const maxHeight = Math.max(80, Math.min(320, up ? above - 6 : below - 6));
  return { top, left, width, maxHeight, up };
}

export function nextSelectIndex(currentIndex, delta, length, disabledIndices = new Set()) {
  if (length <= 0) return -1;
  let next = currentIndex;
  for (let step = 0; step < length; step++) {
    next = (next + delta + length) % length;
    if (!disabledIndices.has(next)) return next;
  }
  return currentIndex;
}

export function findOptionByChar(options, char, startIndex = -1) {
  if (!options || !options.length || !char) return -1;
  const c = char.toLowerCase();
  const len = options.length;
  for (let i = 1; i <= len; i++) {
    const idx = (startIndex + i) % len;
    const opt = options[idx];
    if (opt && !opt.disabled) {
      const text = (opt.text || opt.label || '').trim().toLowerCase();
      if (text.startsWith(c)) return idx;
    }
  }
  return -1;
}

export function buildSelectData(select) {
  const items = [];
  const options = [];
  let optIndex = 0;
  for (const child of select.children) {
    if (child.tagName === 'OPTGROUP') {
      items.push({
        type: 'group',
        label: child.label || child.getAttribute('label') || ''
      });
      for (const opt of child.children) {
        if (opt.tagName === 'OPTION') {
          const item = {
            type: 'option',
            value: opt.value,
            text: opt.text || opt.label || opt.value,
            selected: opt.selected,
            disabled: opt.disabled,
            index: optIndex,
            optionEl: opt
          };
          items.push(item);
          options.push(item);
          optIndex++;
        }
      }
    } else if (child.tagName === 'OPTION') {
      const item = {
        type: 'option',
        value: child.value,
        text: child.text || child.label || child.value,
        selected: child.selected,
        disabled: child.disabled,
        index: optIndex,
        optionEl: child
      };
      items.push(item);
      options.push(item);
      optIndex++;
    }
  }
  return { items, options };
}

let current = null;
let serial = 0;

export function closeSelectMenu() {
  if (!current) return;
  const { select, anchor, menu } = current;
  select.setAttribute('aria-expanded', 'false');
  select.removeAttribute('aria-activedescendant');
  select.removeAttribute('aria-controls');
  anchor.classList.remove('select-field-open');
  if (menu.hidePopover && menu.matches(':popover-open')) {
    try { menu.hidePopover(); } catch {}
  }
  menu.remove();
  current = null;
}

export function openSelectMenu(select) {
  if (!select || select.disabled) return;
  closeSelectMenu();

  const anchor = select.closest('.select-field') ?? select;
  const reqId = ++serial;
  const menuId = 'wayfarer-select-menu-' + reqId;
  const { items, options } = buildSelectData(select);
  if (!options.length) return;

  const menu = document.createElement('div');
  menu.id = menuId;
  menu.className = 'wayfarer-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('popover', 'manual');
  menu.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Choices');

  const disabledIndices = new Set();
  const optionElements = [];

  for (const item of items) {
    if (item.type === 'group') {
      const grp = document.createElement('div');
      grp.className = 'wayfarer-select-group';
      grp.setAttribute('role', 'group');
      if (item.label) {
        const title = document.createElement('div');
        title.className = 'wayfarer-select-group-title';
        title.textContent = item.label;
        grp.append(title);
      }
      menu.append(grp);
    } else {
      if (item.disabled) disabledIndices.add(item.index);
      const row = document.createElement('div');
      row.className = 'wayfarer-select-option';
      row.id = menuId + '-opt-' + item.index;
      row.setAttribute('role', 'option');
      row.dataset.value = item.value;
      row.dataset.index = String(item.index);
      row.setAttribute('aria-selected', String(item.selected));
      if (item.disabled) {
        row.setAttribute('aria-disabled', 'true');
      }

      const isSub = item.text.startsWith('  ') || /^\s*player version/i.test(item.text);
      if (isSub) row.classList.add('wayfarer-select-subitem');

      const check = document.createElement('span');
      check.className = 'wayfarer-select-check';
      if (item.selected) {
        check.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      }

      const label = document.createElement('span');
      label.className = 'wayfarer-select-label';
      label.textContent = item.text;

      row.append(check, label);
      row.addEventListener('pointerdown', (e) => e.preventDefault());
      row.addEventListener('click', () => {
        if (!item.disabled) {
          selectOption(item.value);
        }
      });

      menu.append(row);
      optionElements.push(row);
    }
  }

  function selectOption(val) {
    if (select.value !== val) {
      select.value = val;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closeSelectMenu();
    select.focus({ preventScroll: true });
  }

  (select.closest('dialog[open]') ?? document.body).append(menu);
  if (menu.showPopover) {
    try { menu.showPopover(); } catch {}
  }

  let selectedIdx = options.findIndex(o => o.selected);
  if (selectedIdx < 0) selectedIdx = 0;

  current = {
    select,
    anchor,
    menu,
    options,
    optionElements,
    disabledIndices,
    activeIndex: selectedIdx,
    selectOption
  };

  select.setAttribute('aria-expanded', 'true');
  select.setAttribute('aria-controls', menuId);
  anchor.classList.add('select-field-open');

  placeCurrent();
  highlightOption(selectedIdx, true);
}

function placeCurrent() {
  if (!current) return;
  const { anchor, menu } = current;
  if (!anchor.isConnected || !menu.isConnected) {
    closeSelectMenu();
    return;
  }
  const dialog = anchor.closest('dialog');
  if (dialog && !dialog.open) {
    closeSelectMenu();
    return;
  }
  const r = anchor.getBoundingClientRect();
  const pos = positionMenu(r, { width: window.innerWidth, height: window.innerHeight }, menu.scrollHeight, 180);
  Object.assign(menu.style, {
    left: pos.left + 'px',
    top: pos.top + 'px',
    width: pos.width + 'px',
    maxHeight: pos.maxHeight + 'px'
  });
}

function highlightOption(idx, scroll = false) {
  if (!current) return;
  const { optionElements, select } = current;
  for (let i = 0; i < optionElements.length; i++) {
    const el = optionElements[i];
    const isHigh = i === idx;
    el.classList.toggle('wayfarer-select-highlight', isHigh);
    if (isHigh) {
      select.setAttribute('aria-activedescendant', el.id);
      if (scroll) el.scrollIntoView({ block: 'nearest' });
    }
  }
  current.activeIndex = idx;
}

let installed = false;
export function installCustomSelect() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  // Intercept pointer interactions on any single select or .select-field wrapper
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (current && current.menu.contains(target)) return;

    const sel = findSelect(target);
    if (sel) {
      if (sel.disabled) return;
      event.preventDefault();
      if (current && current.select === sel) {
        closeSelectMenu();
      } else {
        sel.focus({ preventScroll: true });
        openSelectMenu(sel);
      }
      return;
    }

    if (current && !current.menu.contains(target) && !current.anchor.contains(target)) {
      closeSelectMenu();
    }
  }, true);

  // Keyboard accessibility and navigation
  document.addEventListener('keydown', (event) => {
    const target = event.target;

    if (!current) {
      if (target?.tagName === 'SELECT' && !target.multiple) {
        if ([' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key) || (event.altKey && event.key === 'ArrowDown')) {
          event.preventDefault();
          openSelectMenu(target);
        }
      }
      return;
    }

    const { select, options, activeIndex, disabledIndices, selectOption } = current;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSelectMenu();
      select.focus({ preventScroll: true });
      return;
    }

    if (event.key === 'Tab') {
      closeSelectMenu();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = nextSelectIndex(activeIndex, 1, options.length, disabledIndices);
      highlightOption(next, true);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nextSelectIndex(activeIndex, -1, options.length, disabledIndices);
      highlightOption(next, true);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      const next = nextSelectIndex(-1, 1, options.length, disabledIndices);
      highlightOption(next, true);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const next = nextSelectIndex(options.length, -1, options.length, disabledIndices);
      highlightOption(next, true);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < options.length && !disabledIndices.has(activeIndex)) {
        selectOption(options[activeIndex].value);
      }
      return;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const matchIdx = findOptionByChar(options, event.key, activeIndex);
      if (matchIdx >= 0) {
        event.preventDefault();
        highlightOption(matchIdx, true);
      }
    }
  }, true);

  // Mouse hover highlights
  document.addEventListener('pointerover', (event) => {
    if (!current) return;
    const optEl = event.target.closest?.('.wayfarer-select-option:not([aria-disabled="true"])');
    if (optEl && current.menu.contains(optEl)) {
      const idx = Number(optEl.dataset.index);
      if (!Number.isNaN(idx)) highlightOption(idx, false);
    }
  });

  // Reposition on scroll unless scrolling inside the menu
  document.addEventListener('scroll', (event) => {
    if (current && !current.menu.contains(event.target)) {
      placeCurrent();
    }
  }, true);

  window.addEventListener('resize', placeCurrent);
  window.addEventListener('hashchange', closeSelectMenu);

  document.addEventListener('focusin', (event) => {
    if (current && !current.anchor.contains(event.target) && !current.menu.contains(event.target)) {
      closeSelectMenu();
    }
  });

  document.addEventListener('close', (event) => {
    if (current && current.anchor.closest('dialog') === event.target) {
      closeSelectMenu();
    }
  }, true);
}

installCustomSelect();
