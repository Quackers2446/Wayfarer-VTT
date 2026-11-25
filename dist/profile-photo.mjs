import {escape} from './format.mjs';

export function profilePhotoURL(id, photo) {
  if (!/^[a-f0-9-]{36}$/.test(id ?? '') || !/^[a-f0-9]{64}$/.test(photo ?? '')) return '';
  return `/api/account/avatars/${id}/${photo}`;
}

export function profilePortrait({id, photo, displayName, username}, className = 'profile-avatar') {
  const url = profilePhotoURL(id, photo);
  const initials = (displayName || username || '').trim().split(/\s+/).slice(0, 2).map(word => [...word][0]).join('').toUpperCase();
  return `<span class="${className}" aria-hidden="true">${url ? `<img src="${url}" alt="" decoding="async">` : escape(initials || '?')}</span>`;
}
