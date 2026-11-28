import {escape} from './format.mjs';
import {sessionCode,sessionHash} from './multiplayer.mjs';
const key='wayfarer-rooms-v1';
let cached=[];
try {const value=JSON.parse(localStorage.getItem(key));if(Array.isArray(value))cached=value.filter(room=>sessionCode(room.id));}catch{}
const activity=room=>Math.max(room.updatedAt||0,room.lastVisited||0);
export const knownRooms=()=>cached.slice().sort((a,b)=>activity(b)-activity(a));
/** Campaign / practice rooms only — hub taverns use a separate entry path. */
export const knownCampaignRooms=()=>knownRooms().filter(room=>room.kind!=='hub' && room.adventure!=='YPHub');
export function rememberRooms(rooms,{authoritative=false}={}) {
  const merged=new Map(authoritative?[]:cached.map(room=>[room.id,room]));
  for(const room of rooms) if(sessionCode(room.id)) {
    const previous=merged.get(room.id);
    const kind=room.kind==='hub'||previous?.kind==='hub'?'hub':(room.kind||previous?.kind||'campaign');
    merged.set(room.id,{...previous,...room,kind,lastVisited:Math.max(previous?.lastVisited||0,room.lastVisited||0)});
  }
  cached=[...merged.values()].sort((a,b)=>activity(b)-activity(a)).slice(0,100);
  try {localStorage.setItem(key,JSON.stringify(cached));}catch{}
  return knownRooms();
}
export function forgetRoom(id){
  cached=cached.filter(room=>room.id!==id);
  try{localStorage.setItem(key,JSON.stringify(cached));if(localStorage.getItem('wayfarer-last-session-v1')===id)localStorage.removeItem('wayfarer-last-session-v1');}catch{}
  return knownRooms();
}
export function rememberRoom(id,map,state) {
  const room=state.room ?? {};
  const kind=room.kind==='hub'||map.module==='YPHub'?'hub':'campaign';
  return rememberRooms([{id,name:room.name || map.title,adventure:room.adventure || map.module,
    adventureName:room.adventureName || map.module,mapName:map.title,mapKey:map.key,kind,
    hubSession:typeof room.hubSession==='string'?room.hubSession:null,
    party:state.battle.actors.filter(actor=>actor.side==='party').map(actor=>actor.name),round:state.battle.round,
    createdAt:room.createdAt || Date.now(),updatedAt:room.updatedAt || Date.now(),lastVisited:Date.now()}]);
}
export function roomList(rooms,{loading=false,error='',deleting=''}={}) {
  const campaigns=rooms.filter(room=>room.kind!=='hub' && room.adventure!=='YPHub');
  const date=value=>{try{return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(value);}catch{return 'recently';}};
  return `<section class="adventure-rooms" aria-label="Your adventure rooms">
    <header class="play-header"><div><h1>Adventure rooms</h1><p>Campaigns and practice tables live here. The Yawning Portal is a separate hub.</p></div>
      <div class="play-header-actions"><a class="button outline small" href="#hub">Enter the Yawning Portal</a>
      <button type="button" class="button primary small" data-play="new-room">New adventure room</button></div></header>
    <div class="room-grid">${campaigns.map(room=>`<article class="adventure-room" data-room="${escape(room.id)}">
      <div class="room-card-heading"><span class="tag">${escape(room.adventureName || room.adventure)}</span><small>${room.round ? 'Round '+escape(room.round) : 'Exploring'}</small></div>
      <h2>${escape(room.name)}</h2><p class="room-map-name">${escape(room.mapName)}</p>
      <p class="room-party">${escape(Array.isArray(room.party) && room.party.length ? room.party.join(' · ') : 'No characters yet')}</p>
      <div class="room-card-bottom"><small>Saved ${escape(date(room.updatedAt))}</small><a class="button outline small" href="${sessionHash(room.id)}" aria-label="Resume ${escape(room.name)}">Resume room</a></div>
      ${room.canDelete ? `<button type="button" class="room-delete" data-play="delete-room" data-id="${escape(room.id)}" aria-label="Delete ${escape(room.name)}" ${deleting?'disabled':''}>${deleting===room.id?'Deleting…':'Delete room'}</button>`:''}
    </article>`).join('')}</div>
    ${!campaigns.length ? `<p class="room-empty">${loading ? 'Loading your rooms…' : 'Create a campaign room for an adventure, or meet friends first in the Yawning Portal.'}</p>` : ''}
    <p class="room-list-status" role="status">${escape(error || (loading ? 'Checking saved rooms…' : 'Rooms save automatically. Each invite link returns to the same campaign.'))}</p>
  </section>`;
}
