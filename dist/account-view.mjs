import {profilePortrait} from './profile-photo.mjs';
import {icon} from './icons.mjs';
import {escape} from './format.mjs';
import {accountState,mountGoogleButton,syncAccount,signOutAccount,saveAccountProfile,saveAccountPhoto,resolveAccountConflict} from './account-client.mjs';
import {THEME_PRESETS, THEME_SLOTS, readThemePreference, setThemePreset, setCustomTheme} from './theme.mjs';

export function accountBadge(){
 const {user,ready}=accountState();
 return `<a class="account-badge" href="#profile" aria-label="${user?'Open profile':'Sign in'}">${user?profilePortrait(user,'account-avatar'):icon('users',17)}<span>${escape(user?.displayName??(ready?'Sign in':'Account…'))}</span></a>`;
}

function themePanelHtml(preference){
 const colors=preference.colors;
 const swatches=THEME_PRESETS.map(preset=>`
  <button type="button" class="theme-preset${preference.id===preset.id?' is-active':''}" data-theme-preset="${escape(preset.id)}" aria-pressed="${preference.id===preset.id?'true':'false'}" title="${escape(preset.blurb)}">
   <span class="theme-preset-swatch" style="--swatch-a:${escape(preset.colors.ground)};--swatch-b:${escape(preset.colors.panel)};--swatch-c:${escape(preset.colors.accent)}"></span>
   <span class="theme-preset-copy"><strong>${escape(preset.name)}</strong><small>${escape(preset.blurb)}</small></span>
  </button>`).join('');
 const pickers=THEME_SLOTS.map(slot=>`
  <label class="theme-color-field">${escape(slot.label)}
   <span class="theme-color-row">
    <input type="color" name="${escape(slot.id)}" value="${escape(colors[slot.id])}" aria-label="${escape(slot.label)} color">
    <input type="text" name="${escape(slot.id)}-hex" value="${escape(colors[slot.id])}" maxlength="7" spellcheck="false" inputmode="text" aria-label="${escape(slot.label)} hex">
   </span>
   <small>${escape(slot.hint)}</small>
  </label>`).join('');
 return `<section class="panel account-panel theme-panel" aria-label="Display theme">
  <h2>Display theme</h2>
  <p>Pick a preset or dial in the base colours Wayfarer uses for the table and accents. Themes stay on this device.</p>
  <div class="theme-table-preview" aria-hidden="true">
   <p class="theme-table-preview-label">Table preview</p>
   <div class="theme-table-row">
    <span class="theme-table-btn">Action</span>
    <span class="theme-table-btn is-on">Active</span>
    <input class="theme-table-search" readonly tabindex="-1" value="Search">
   </div>
  </div>
  <div class="theme-presets" role="group" aria-label="Theme presets">${swatches}
   <button type="button" class="theme-preset${preference.id==='custom'?' is-active':''}" data-theme-preset="custom" aria-pressed="${preference.id==='custom'?'true':'false'}">
    <span class="theme-preset-swatch theme-preset-swatch-custom" style="--swatch-a:${escape(colors.ground)};--swatch-b:${escape(colors.panel)};--swatch-c:${escape(colors.accent)}"></span>
    <span class="theme-preset-copy"><strong>Custom</strong><small>Choose each base colour below.</small></span>
   </button>
  </div>
  <form class="theme-custom-form" data-theme-custom ${preference.id==='custom'?'':'hidden'}>
   <div class="theme-color-grid">${pickers}</div>
   <div class="account-buttons">
    <button class="button primary" type="submit">Save custom theme</button>
    <button class="button outline" type="button" data-theme-reset>Back to Grove</button>
   </div>
  </form>
 </section>`;
}

function bindThemePanel(host){
 const form=host.querySelector('[data-theme-custom]');
 function refresh(apply){
  apply();
  delete host.dataset.signature;
  mountAccountProfile(host);
 }
 for(const button of host.querySelectorAll('[data-theme-preset]')){
  button.addEventListener('click',()=>{
   const id=button.dataset.themePreset;
   if(id==='custom'){
    refresh(()=>setCustomTheme(readThemePreference().colors));
    return;
   }
   refresh(()=>setThemePreset(id));
  });
 }
 function liveColors(){
  const data=new FormData(form);
  const colors={};
  for(const slot of THEME_SLOTS)colors[slot.id]=String(data.get(slot.id)||'');
  return colors;
 }
 form?.addEventListener('input',event=>{
  const target=event.target;
  if(!(target instanceof HTMLInputElement))return;
  if(target.type==='color'){
   const hex=form.querySelector(`[name="${target.name}-hex"]`);
   if(hex)hex.value=target.value;
  }else if(target.name?.endsWith('-hex')){
   const id=target.name.slice(0,-4);
   const color=form.querySelector(`input[type=color][name="${id}"]`);
   if(color&&/^#[0-9a-fA-F]{6}$/.test(target.value.trim())){
    color.value=target.value.trim();
    target.value=target.value.trim().toLowerCase();
   }else return;
  }
  const colors=liveColors();
  setCustomTheme(colors);
  const swatch=host.querySelector('.theme-preset-swatch-custom');
  if(swatch){
   swatch.style.setProperty('--swatch-a',colors.ground);
   swatch.style.setProperty('--swatch-b',colors.panel);
   swatch.style.setProperty('--swatch-c',colors.accent);
  }
 });
 form?.addEventListener('submit',event=>{
  event.preventDefault();
  const data=new FormData(form);
  const colors={};
  for(const slot of THEME_SLOTS)colors[slot.id]=String(data.get(slot.id)||'');
  refresh(()=>setCustomTheme(colors));
 });
 host.querySelector('[data-theme-reset]')?.addEventListener('click',()=>refresh(()=>setThemePreset('grove')));
}

export function mountAccountProfile(host){
 const state=accountState(),{user,googleClientId,ready,conflicts,sessionReached}=state;
 const preference=readThemePreference();
 const signature=JSON.stringify([user,googleClientId,ready,conflicts,sessionReached,preference]);
 if(host.dataset.signature===signature){host.querySelector('[data-sync-status]').textContent=state.status;host.querySelector('[data-account-sync]')?.toggleAttribute('disabled',state.busy);return;}host.dataset.signature=signature;
 host.innerHTML=`<section class="account-profile"><header class="page-heading"><div><h1>${user?'Your profile':'Your Wayfarer account'}</h1><p>${user?'Your adventurers, wherever you play.':'Sign in to keep your characters and adventure rooms across devices.'}</p></div></header><section class="panel account-panel">${user?`<div class="profile-identity">${profilePortrait(user)}<div><h2>${escape(user.displayName)}</h2><p>${escape(user.email)}</p></div></div><div class="account-buttons profile-photo-controls"><label for="profile-photo" class="button outline small">Choose profile photo</label><input id="profile-photo" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp">${user.photo?'<button class="button outline small" type="button" data-remove-profile-photo>Remove photo</button>':''}</div><form class="account-profile-form"><label>Display name<input name="displayName" maxlength="24" value="${escape(user.displayName)}" required></label><label>About your adventurer<textarea name="bio" maxlength="240" rows="3">${escape(user.bio)}</textarea></label><button class="button primary" type="submit">Save profile</button></form><p class="account-sync-status" data-sync-status role="status">${escape(state.status)}</p><div class="account-buttons"><button class="button outline" type="button" data-account-sync ${state.busy?'disabled':''}>Sync now</button><button class="button outline" type="button" data-account-logout>Sign out</button></div>`:`<h2>Keep your party with you</h2><p>Google sign-in creates your Wayfarer profile. Characters, token images, saved spell rules and room links follow you to another device.</p><div class="google-sign-in" data-google-sign-in>${!ready?'Checking sign-in…':googleClientId?'Loading Google sign-in…':sessionReached?'Google sign-in is being configured. You can keep playing as a guest.':'Sign-in is temporarily unavailable. Refresh to try again, or keep playing as a guest.'}</div><p class="account-sync-status" data-sync-status role="status">${escape(state.status)}</p><a class="text-link" href="#characters">Continue as a guest</a>`}</section>${themePanelHtml(preference)}${conflicts.length?`<section class="panel account-panel" aria-label="Sync conflicts"><h2>Choose which changes to keep</h2><p>These items changed on both devices. Both versions are retained until you choose.</p>${conflicts.map((conflict,index)=>`<article class="account-conflict"><strong>${escape(conflict.name)}</strong><span>${escape(conflict.kind)}</span><p>This device: ${conflict.local?'edited':'deleted'} · Cloud: ${conflict.cloud?'edited':'deleted'}</p><details><summary>Compare changes</summary><div class="account-compare"><div><h3>This device</h3><pre>${escape(JSON.stringify(conflict.local??null,null,2))}</pre></div><div><h3>Cloud</h3><pre>${escape(JSON.stringify(conflict.cloud??null,null,2))}</pre></div></div></details><div class="account-buttons"><button type="button" class="button outline small" data-conflict="${index}" data-version="local">Keep this device</button><button type="button" class="button outline small" data-conflict="${index}" data-version="cloud">Keep cloud version</button></div></article>`).join('')}</section>`:''}<section class="panel account-panel"><h2>What follows your account</h2><p>Saved characters and their token images, your spell-rule library, profile, and linked rooms sync. Existing browser characters import on your first sign-in. Private creator credentials link rooms you created in this browser.</p><p>Unfinished builder drafts, the attached 5etools ZIP, Gemini API keys, and display preferences stay on this device.</p></section></section>`;
 const file=host.querySelector('#profile-photo'), remove=host.querySelector('[data-remove-profile-photo]');
 async function updatePhoto(image){
  if(file.disabled)return;
  file.disabled=true;
  if(remove)remove.disabled=true;
  const message=host.querySelector('[data-sync-status]');
  message.textContent=image?'Uploading profile photo…':'Removing profile photo…';
  try{await saveAccountPhoto(image);}
  catch(error){message.textContent=error.message;}
  finally{file.value='';file.disabled=false;if(remove)remove.disabled=false;}
 }
 file?.addEventListener('change',()=>{if(file.files[0])void updatePhoto(file.files[0]);});
 remove?.addEventListener('click',()=>void updatePhoto(null));
 host.querySelector('form.account-profile-form')?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.target);try{await saveAccountProfile(data.get('displayName'),data.get('bio'));}catch(error){host.querySelector('[data-sync-status]').textContent=error.message;}});
 host.querySelector('[data-account-sync]')?.addEventListener('click',()=>void syncAccount());
 host.querySelector('[data-account-logout]')?.addEventListener('click',async()=>{try{await signOutAccount();}catch(error){host.querySelector('[data-sync-status]').textContent=error.message;}});
 for(const button of host.querySelectorAll('[data-conflict]'))button.addEventListener('click',()=>void resolveAccountConflict(Number(button.dataset.conflict),button.dataset.version));
 const google=host.querySelector('[data-google-sign-in]');if(google&&ready&&googleClientId)void mountGoogleButton(google);
 bindThemePanel(host);
}
