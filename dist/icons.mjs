const paths = {
  home: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>',
  book: '<path d="M12 7a5 5 0 0 0-5-5H3v17h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5V2h-4a5 5 0 0 0-5 5zm0 0v15"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  file: '<path d="M6 2h8l4 4v16H6zM14 2v5h4M9 12h6m-6 4h6"/>',
  sheet: '<path d="M6 2h8l4 4v16H6zM14 2v5h4M6 10h12M6 16h12m-6-6v12"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>',
  shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10s-8-5-8-10V6z"/>',
  shieldCheck: '<path d="m12 2 8 4v6c0 5-8 10-8 10s-8-5-8-10V6zM9 12l2 2 4-4"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6zm6-3v15m6-12v15"/>',
  mountain: '<path d="m2 19 8-12 4 6 2-3 6 9H2zm6-9 2 2 2-2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-1.5 1.5m2.5 6a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  flag: '<path d="M4 22V3m0 1c5-4 10 4 16 0v11c-6 4-11-4-16 0"/>',
  dice: '<path d="m12 2 9 6v9l-9 5-9-5V8zm0 0L3 17m9-15 9 15M3 17h18M3 8l9 14 9-14"/>',
};
export function icon(name, size = 19) {
  return '<svg class="icon" aria-hidden="true" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] ?? paths.file) + '</svg>';
}
