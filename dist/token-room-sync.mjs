import {knownRooms} from './adventure-rooms.mjs';
import {readSession,writeSession} from './multiplayer.mjs';
import {uploadSessionToken} from './character-token.mjs';

// Update only rooms whose invitation is already stored in this browser. Never
// enumerate arbitrary rooms or replace a room snapshot after a revision conflict.
export async function syncCharacterTokenRooms(characterId,image,{exclude}={}){
  const actorId=characterId.startsWith('party:') ? characterId : 'party:'+characterId;
  const failed=[];
  for(const room of knownRooms()) {
    if(room.id===exclude) continue;
    try {
      let snapshot=await readSession(room.id),uploaded=false;
      for(let attempt=0;attempt<4;attempt++){
        const actor=snapshot.state.battle.actors.find(actor=>actor.id===actorId && actor.side==='party');
        if(!actor) break;
        if(actor.tokenImage===image || !image && !actor.tokenImage) break;
        if(image && !uploaded){await uploadSessionToken(room.id,image);uploaded=true;}
        if(image) actor.tokenImage=image;else delete actor.tokenImage;
        const sheet=snapshot.state.battle.sheets?.[actorId];
        if(sheet){if(image) sheet.tokenImage=image;else delete sheet.tokenImage;}
        const result=await writeSession(room.id,snapshot.revision,snapshot.state);
        if(!result.state) break;
        snapshot=result;
        if(attempt===3) throw new Error('Room is busy');
      }
    }catch(error){if(error.status!==404) failed.push(room.name || 'Adventure room');}
  }
  return failed;
}
