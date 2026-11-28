import {validRuleSet} from './spell-rule-schema.mjs';

export const accounts=(()=>{
 const sessionCookie='__Host-wayfarer-account',nonceCookie='__Host-wayfarer-login',hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),random=()=>hex(crypto.getRandomValues(new Uint8Array(32))),sha=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))),maxBytes=1536*1024;
 const response=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...extra}});
 const cookie=(name,value,seconds)=>`${name}=${value}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Strict`;
 const credential=(request,name)=>{const values=(request.headers.get('Cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));const value=values.length===1?values[0].slice(name.length+1):'';return /^[a-f0-9]{64}$/.test(value)?value:null;};
 const profile=row=>row?{id:row.id,email:row.email,displayName:row.display_name,bio:row.bio,createdAt:row.created_at,photo:row.photo_id??null}:null;
 const normalizeEmail=value=>String(value||'').trim().toLowerCase();
 const emailOk=value=>{const email=normalizeEmail(value);return email.length>3&&email.length<=320&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);};
 const closedBeta=env=>env?.CLOSED_BETA==='1'||env?.CLOSED_BETA===1||env?.CLOSED_BETA===true;
 const adminEmails=env=>String(env?.BETA_ADMIN_EMAILS||'').split(/[,;\s]+/).map(normalizeEmail).filter(emailOk);
 const isAdminEmail=(env,email)=>adminEmails(env).includes(normalizeEmail(email));
 async function isApproved(env,email){
  const normalized=normalizeEmail(email);if(!emailOk(normalized))return false;
  if(isAdminEmail(env,normalized))return true;
  if(!closedBeta(env))return true;
  try{return Boolean(await env.DB.prepare('SELECT email FROM beta_allowlist WHERE email=?').bind(normalized).first());}
  catch{return false;}
 }
 async function ensureAdminListed(env,email){
  const normalized=normalizeEmail(email);if(!isAdminEmail(env,normalized))return;
  try{await env.DB.prepare('INSERT INTO beta_allowlist(email,note,created_at,created_by) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING').bind(normalized,'Beta admin',Date.now(),'system').run();}catch{/* table may be missing until migration */}
 }
 async function allowlistEmail(env,email,{note='',createdBy=null}={}){
  const normalized=normalizeEmail(email);if(!emailOk(normalized))return false;
  await env.DB.prepare('INSERT INTO beta_allowlist(email,note,created_at,created_by) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET note=CASE WHEN excluded.note=? THEN beta_allowlist.note ELSE excluded.note END').bind(normalized,note,Date.now(),createdBy,note).run();
  return true;
 }
 const inviteTokenOk=value=>typeof value==='string'&&/^[a-f0-9]{32,64}$/.test(value);
 /** Redeem a shareable invite for any Google email — adds them to the allowlist. */
 async function redeemInvite(env,rawToken,email){
  if(!inviteTokenOk(rawToken)||!emailOk(email))return {ok:false,message:'This invite link is invalid.'};
  const hash=await sha(rawToken);
  const row=await env.DB.prepare('SELECT token_hash,label,expires_at,max_uses,use_count,revoked FROM beta_invites WHERE token_hash=?').bind(hash).first();
  if(!row||row.revoked)return {ok:false,message:'This invite link is no longer valid.'};
  if(row.expires_at!=null&&row.expires_at<=Date.now())return {ok:false,message:'This invite link has expired.'};
  if(row.max_uses>0&&row.use_count>=row.max_uses)return {ok:false,message:'This invite link has already been used up.'};
  const note=row.label?('Invite: '+row.label):'Joined via invite link';
  await allowlistEmail(env,email,{note,createdBy:'invite:'+hash.slice(0,12)});
  const updated=await env.DB.prepare('UPDATE beta_invites SET use_count=use_count+1 WHERE token_hash=? AND revoked=0 AND (expires_at IS NULL OR expires_at>?) AND (max_uses=0 OR use_count<max_uses) RETURNING use_count').bind(hash,Date.now()).first();
  if(!updated)return {ok:false,message:'This invite link could not be redeemed. Try again or ask for a new invite.'};
  return {ok:true,label:row.label||null};
 }
 async function peekInvite(env,rawToken){
  if(!inviteTokenOk(rawToken))return {valid:false,message:'This invite link is invalid.'};
  const row=await env.DB.prepare('SELECT label,expires_at,max_uses,use_count,revoked FROM beta_invites WHERE token_hash=?').bind(await sha(rawToken)).first();
  if(!row||row.revoked)return {valid:false,message:'This invite link is no longer valid.'};
  if(row.expires_at!=null&&row.expires_at<=Date.now())return {valid:false,message:'This invite link has expired.'};
  if(row.max_uses>0&&row.use_count>=row.max_uses)return {valid:false,message:'This invite link has already been used up.'};
  return {valid:true,label:row.label||null,remaining:row.max_uses>0?Math.max(0,row.max_uses-row.use_count):null};
 }
 async function identity(request,env){const token=credential(request,sessionCookie);if(!token)return null;return env.DB.prepare('SELECT u.*,p.image_id AS photo_id FROM account_users u LEFT JOIN account_photos p ON p.user_id=u.id JOIN account_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(await sha(token),Date.now()).first();}
 async function clearSession(request,env){const token=credential(request,sessionCookie);if(token)await env.DB.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await sha(token)).run();return cookie(sessionCookie,'',0);}
 async function roomOwner(env,id){return env.DB.prepare("SELECT user_id FROM account_rooms WHERE room_id=? AND role='owner'").bind(id).first();}
 async function addRoom(env,user,id,owner=false){if(!user)return;await env.DB.prepare("INSERT INTO account_rooms (user_id,room_id,role) SELECT ?,id,? FROM game_sessions WHERE id=? ON CONFLICT(user_id,room_id) DO UPDATE SET role=CASE WHEN excluded.role='owner' THEN 'owner' ELSE account_rooms.role END").bind(user.id,owner?'owner':'member',id).run();}
 async function jsonBody(request,limit=maxBytes+2048){const reader=request.body?.getReader();if(!reader)throw Error('Missing request body.');let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('This account library is too large.');}chunks.push(value);}return JSON.parse(await new Blob(chunks).text());}
 /** Approved signed-in user for closed beta, or null when beta is off and guests are allowed. */
 async function requireApproved(request,env){
  if(!closedBeta(env))return {user:await identity(request,env)};
  const user=await identity(request,env);
  if(!user)return {error:response({message:'Wayfarer is in closed beta. Sign in with an approved Google account.',closedBeta:true},401)};
  if(!(await isApproved(env,user.email))){
   const clear=await clearSession(request,env);
   return {error:response({message:'This Google account is not on the closed beta list.',closedBeta:true},403,{'Set-Cookie':clear})};
  }
  return {user};
 }
 const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 let keysCache=null,keysExpires=0;
 async function googleKeys(force=false){if(!force&&keysCache&&Date.now()<keysExpires)return keysCache;const result=await fetch('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(10000)});if(!result.ok)throw Error('Google verification is temporarily unavailable.');const data=await result.json();if(!Array.isArray(data.keys))throw Error('Google verification keys are unavailable.');keysCache=data.keys;keysExpires=Date.now()+Math.min(21600,Number(/max-age=(\d+)/.exec(result.headers.get('Cache-Control')??'')?.[1]??300))*1000;return keysCache;}
 async function verify(token,clientId,nonce){
  if(typeof token!=='string'||token.length>16000)throw Error('Invalid Google sign-in response.');const parts=token.split('.');if(parts.length!==3)throw Error('Invalid Google sign-in response.');let header,payload;try{header=JSON.parse(new TextDecoder().decode(decode(parts[0])));payload=JSON.parse(new TextDecoder().decode(decode(parts[1])));}catch{throw Error('Invalid Google sign-in response.');}
  if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error('Invalid Google signature.');let key=(await googleKeys()).find(k=>k.kid===header.kid);if(!key)key=(await googleKeys(true)).find(k=>k.kid===header.kid);if(!key)throw Error('Unknown Google signing key.');const imported=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',imported,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error('Invalid Google signature.');
  const now=Math.floor(Date.now()/1000);if(!['accounts.google.com','https://accounts.google.com'].includes(payload.iss)||!(payload.aud===clientId||Array.isArray(payload.aud)&&payload.aud.includes(clientId))||payload.azp&&payload.azp!==clientId||!Number.isFinite(payload.exp)||payload.exp<=now||!Number.isFinite(payload.iat)||payload.iat>now+60||payload.iat<now-7200||payload.nonce!==nonce||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255||payload.email_verified!==true||typeof payload.email!=='string'||payload.email.length>320)throw Error('Google sign-in could not be verified. Please try again.');return payload;
 }
 const name=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=24&&!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
 const blank=()=>({characters:[],spellRules:{},active:null,preferredCharacter:null});
 const preferredId=workspace=>{const id=workspace?.preferredCharacter;return typeof id==='string'&&id&&(workspace.characters??[]).some(character=>character.id===id)?id:null;};
 function validWorkspace(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.characters)&&value.characters.length<=100&&new Set(value.characters.map(c=>c?.id)).size===value.characters.length&&value.characters.every(c=>c&&typeof c==='object'&&!Array.isArray(c)&&typeof c.id==='string'&&c.id.length>0&&c.id.length<=160&&typeof c.name==='string'&&c.name.length<=50000&&(c.tokenImage==null||/^[a-f0-9]{64}$/.test(c.tokenImage)))&&(value.preferredCharacter==null||preferredId(value)===value.preferredCharacter)&&validRuleSet(value.spellRules??{})&&new TextEncoder().encode(JSON.stringify(value)).byteLength<=maxBytes;}
 async function workspace(env,user){const row=await env.DB.prepare('SELECT data,revision FROM account_workspaces WHERE user_id=?').bind(user.id).first();const tokens=await env.DB.prepare('SELECT token_id FROM account_tokens WHERE user_id=?').bind(user.id).all();return {workspace:row?JSON.parse(row.data):blank(),revision:row?.revision??0,tokens:tokens.results.map(row=>row.token_id)};}
 async function route(request,env,{ownerHash,ownsRoom,validToken,boundedBody}={}){
  const url=new URL(request.url),path=url.pathname;if(!path.startsWith('/api/auth/')&&!path.startsWith('/api/account'))return null;
  if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return response({message:'Open Wayfarer to update your account.'},403);
  const avatar=/^\/api\/account\/avatars\/([a-f0-9-]{36})\/([a-f0-9]{64})$/.exec(path);
  if(avatar&&request.method==='GET'){
   const image=await env.DB.prepare('SELECT content_type,body FROM account_photos WHERE user_id=? AND image_id=?').bind(avatar[1],avatar[2]).first();
   return image?new Response(new Uint8Array(image.body),{headers:{'Content-Type':image.content_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}):response({message:'This profile photo is unavailable.'},404);
  }
  let user=await identity(request,env);
  try{
   if(path==='/api/auth/session'&&request.method==='GET'){
    const beta=closedBeta(env);
    let clear=null;
    if(user && beta && !(await isApproved(env,user.email))){
     clear=await clearSession(request,env);user=null;
    }
    if(user)await ensureAdminListed(env,user.email);
    const payload={user:profile(user),googleClientId:env.GOOGLE_CLIENT_ID??null,closedBeta:beta,betaAdmin:Boolean(user&&isAdminEmail(env,user.email))};
    return clear?response(payload,200,{'Set-Cookie':clear}):response(payload);
   }
   if(path==='/api/auth/nonce'&&request.method==='POST'){
    if(!env.GOOGLE_CLIENT_ID)return response({message:'Google sign-in is waiting for site configuration.'},503);
    const nonce=random(),expires=Date.now()+600000;await env.DB.batch([env.DB.prepare('DELETE FROM account_challenges WHERE expires_at<?').bind(Date.now()),env.DB.prepare('INSERT INTO account_challenges(nonce_hash,expires_at) VALUES (?,?)').bind(await sha(nonce),expires)]);return response({nonce},200,{'Set-Cookie':cookie(nonceCookie,nonce,600)});
   }
   if(path==='/api/auth/google'&&request.method==='POST'){
    if(!env.GOOGLE_CLIENT_ID)return response({message:'Google sign-in is waiting for site configuration.'},503);const nonce=credential(request,nonceCookie);if(!nonce)return response({message:'Start Google sign-in again.'},401);const hash=await sha(nonce),challenge=await env.DB.prepare('SELECT expires_at FROM account_challenges WHERE nonce_hash=? AND expires_at>?').bind(hash,Date.now()).first();if(!challenge)return response({message:'This sign-in attempt expired. Please try again.'},401);
    const input=await jsonBody(request,20000);let google;try{google=await verify(input.credential,env.GOOGLE_CLIENT_ID,nonce);}catch(error){return response({message:error.message},401);}
    const consumed=await env.DB.prepare('DELETE FROM account_challenges WHERE nonce_hash=? AND expires_at>? RETURNING nonce_hash').bind(hash,Date.now()).first();if(!consumed)return response({message:'This sign-in attempt was already used. Please try again.'},401);
    const email=normalizeEmail(google.email);
    let inviteRedeemed=null;
    if(closedBeta(env) && !(await isApproved(env,email))){
     const invite=typeof input.invite==='string'?input.invite:null;
     const redeemed=invite?await redeemInvite(env,invite,email):{ok:false};
     if(!redeemed.ok){
      const denied=response({message:invite?(redeemed.message||'This invite could not be used.'):('Wayfarer is in closed beta. '+email+' is not on the invite list yet. Ask for an invite link.'),closedBeta:true},403);
      denied.headers.append('Set-Cookie',cookie(nonceCookie,'',0));
      return denied;
     }
     inviteRedeemed=redeemed;
    }
    const now=Date.now(),id=crypto.randomUUID(),suggested=String(google.given_name||google.name||'Adventurer').normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,'').trim().slice(0,24)||'Adventurer';
    await env.DB.prepare('INSERT INTO account_users(id,google_sub,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,updated_at=excluded.updated_at').bind(id,google.sub,email,suggested,now,now).run();const row=await env.DB.prepare('SELECT u.*,p.image_id AS photo_id FROM account_users u LEFT JOIN account_photos p ON p.user_id=u.id WHERE u.google_sub=?').bind(google.sub).first(),session=random();await env.DB.batch([env.DB.prepare('DELETE FROM account_sessions WHERE expires_at<?').bind(now),env.DB.prepare('INSERT INTO account_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha(session),row.id,now+30*86400000)]);
    await ensureAdminListed(env,email);
    const result=response({user:profile(row),closedBeta:closedBeta(env),betaAdmin:isAdminEmail(env,email),inviteRedeemed:Boolean(inviteRedeemed)},200,{'Set-Cookie':cookie(sessionCookie,session,30*86400)});result.headers.append('Set-Cookie',cookie(nonceCookie,'',0));return result;
   }
   if(path.startsWith('/api/auth/invite/')&&request.method==='GET'){
    const raw=path.slice('/api/auth/invite/'.length);
    return response({closedBeta:closedBeta(env),...(await peekInvite(env,raw))});
   }
   // Public access request — no sign-in required (closed beta visitors).
   if(path==='/api/auth/beta-request'&&request.method==='POST'){
    if(!closedBeta(env))return response({message:'Wayfarer is open; no access request is needed.'},400);
    const input=await jsonBody(request,4096);
    const email=normalizeEmail(input.email);
    if(!emailOk(email))return response({message:'Enter a valid email address.'},400);
    if(await isApproved(env,email))return response({ok:true,alreadyApproved:true,message:'That email is already approved. Sign in with Google to play.'});
    const requesterName=typeof input.name==='string'?input.name.normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,'').trim().slice(0,48):'';
    const message=typeof input.message==='string'?input.message.normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,'').trim().slice(0,500):'';
    const existing=await env.DB.prepare("SELECT id,status FROM beta_access_requests WHERE email=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(email).first();
    if(existing)return response({ok:true,id:existing.id,status:'pending',message:'A request for this email is already waiting for review.'});
    const id=crypto.randomUUID();
    await env.DB.prepare('INSERT INTO beta_access_requests(id,email,name,message,status,created_at) VALUES (?,?,?,?,?,?)')
     .bind(id,email,requesterName,message,'pending',Date.now()).run();
    return response({ok:true,id,status:'pending',message:'Request submitted. An admin will review it shortly.'});
   }
   if(path==='/api/auth/logout'&&request.method==='POST'){const token=credential(request,sessionCookie);if(token)await env.DB.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await sha(token)).run();return response({ok:true},200,{'Set-Cookie':cookie(sessionCookie,'',0)});}
   if(!user)return response({message:'Sign in to access your account.',closedBeta:closedBeta(env)},401);
   if(closedBeta(env) && !(await isApproved(env,user.email))){
    const clear=await clearSession(request,env);
    return response({message:'This Google account is not on the closed beta list.',closedBeta:true},403,{'Set-Cookie':clear});
   }
   const expectedAccount=request.headers.get('X-Wayfarer-Account');
   if(expectedAccount && expectedAccount!==user.id)return response({message:'The signed-in account changed. Reload Wayfarer before syncing.'},403);
   if(path==='/api/account/profile'&&request.method==='PUT'){const input=await jsonBody(request,2048);if(!name(input.displayName)||typeof input.bio!=='string'||input.bio.length>240)return response({message:'Enter a display name of 1–24 characters and a bio of up to 240 characters.'},400);await env.DB.prepare('UPDATE account_users SET display_name=?,bio=?,updated_at=? WHERE id=?').bind(input.displayName.trim(),input.bio.trim(),Date.now(),user.id).run();return response({user:profile(await env.DB.prepare('SELECT u.*,p.image_id AS photo_id FROM account_users u LEFT JOIN account_photos p ON p.user_id=u.id WHERE u.id=?').bind(user.id).first())});}
   if(path==='/api/account/photo'){
    if(request.method==='DELETE'){
     await env.DB.prepare('DELETE FROM account_photos WHERE user_id=?').bind(user.id).run();
     return response({user:profile({...user,photo_id:null})});
    }
    if(request.method==='PUT'){
     const id=request.headers.get('X-Photo-Id');
     const blob=await boundedBody(request,256*1024);
     if(!blob)return response({message:'Choose an image under 256 KB after resizing.'},413);
     const image=new Blob([blob],{type:request.headers.get('Content-Type')});
     if(!/^[a-f0-9]{64}$/.test(id??'')||!await validToken(image,id))return response({message:'Choose a valid PNG, JPEG, or WebP photo.'},400);
     await env.DB.prepare('INSERT INTO account_photos(user_id,image_id,content_type,body) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET image_id=excluded.image_id,content_type=excluded.content_type,body=excluded.body').bind(user.id,id,image.type,await image.arrayBuffer()).run();
     return response({user:profile({...user,photo_id:id})});
    }
   }
   if(path==='/api/account/workspace'){
    if(request.method==='GET')return response(await workspace(env,user));
    if(request.method==='PUT'){const input=await jsonBody(request);if(!Number.isSafeInteger(input.revision)||input.revision<0||!validWorkspace(input.workspace))return response({message:'The character library or spell rules are invalid or exceed the 1.5 MB account limit.'},400);const value={characters:input.workspace.characters,spellRules:input.workspace.spellRules??{},active:input.workspace.active??null,preferredCharacter:preferredId(input.workspace)};const refs=[...new Set(value.characters.map(c=>c.tokenImage).filter(Boolean))];const available=await env.DB.prepare('SELECT token_id FROM account_tokens WHERE user_id=?').bind(user.id).all();if(refs.some(hash=>!available.results.some(row=>row.token_id===hash)))return response({message:'Upload missing character token images before saving the library.'},400);await env.DB.prepare('INSERT INTO account_workspaces(user_id,data,revision,updated_at) VALUES (?,?,0,?) ON CONFLICT(user_id) DO NOTHING').bind(user.id,JSON.stringify(blank()),Date.now()).run();const result=await env.DB.prepare('UPDATE account_workspaces SET data=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING revision').bind(JSON.stringify(value),Date.now(),user.id,input.revision).first();if(!result)return response({...await workspace(env,user),message:'This account changed on another device.'},409);return response({revision:result.revision});}
   }
   const token=/^\/api\/account\/tokens\/([a-f0-9]{64})$/.exec(path);
   if(token){if(request.method==='GET'){const asset=await env.DB.prepare('SELECT content_type,body FROM account_tokens WHERE user_id=? AND token_id=?').bind(user.id,token[1]).first();return asset?new Response(new Uint8Array(asset.body),{headers:{'Content-Type':asset.content_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}):response({message:'This token is not in your account.'},404);}
    if(request.method==='PUT'){if(Number(request.headers.get('Content-Length'))>1280*1024)return response({message:'Token image is too large.'},413);const reader=request.body?.getReader(),chunks=[];let size=0;if(!reader)return response({message:'Choose a token image.'},400);while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1280*1024){await reader.cancel();return response({message:'Token image is too large.'},413);}chunks.push(value);}const blob=new Blob(chunks,{type:request.headers.get('Content-Type')});if(!await validToken(blob,token[1]))return response({message:'Invalid token image.'},400);const bytes=await blob.arrayBuffer(),saved=await env.DB.prepare('INSERT INTO account_tokens(user_id,token_id,content_type,body,created_at) SELECT ?,?,?,?,? WHERE COALESCE((SELECT SUM(length(body)) FROM account_tokens WHERE user_id=?),0)+?<=16777216 ON CONFLICT(user_id,token_id) DO NOTHING').bind(user.id,token[1],blob.type,bytes,Date.now(),user.id,bytes.byteLength).run();if(!saved.meta.changes&&!await env.DB.prepare('SELECT token_id FROM account_tokens WHERE user_id=? AND token_id=?').bind(user.id,token[1]).first())return response({message:'Your account token images exceed 16 MB.'},413);return response({ok:true});}
   }
   if(path==='/api/account/link-rooms'&&request.method==='POST'){
    const input=await jsonBody(request,16000),roomIds=Array.isArray(input.rooms)?input.rooms.filter(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id)).slice(0,100):[],presented=await ownerHash(request),owned=presented?await env.DB.prepare('SELECT id,state,revision FROM game_sessions WHERE owner_key_hash=?').bind(presented).all():{results:[]};let linked=0;
    for(const room of owned.results){const existing=await roomOwner(env,room.id);if(existing&&existing.user_id!==user.id)continue;await addRoom(env,user,room.id,true);linked++;
     if(typeof input.previousController==='string'&&/^[a-f0-9-]{36}$/.test(input.previousController)&&!await env.DB.prepare('SELECT id FROM account_users WHERE id=?').bind(input.previousController).first()){const state=JSON.parse(room.state),controllers=state.battle?.controllers??{};let changed=false;for(const actor of Object.keys(controllers))if(controllers[actor]===input.previousController){controllers[actor]=user.id;changed=true;}if(changed)await env.DB.prepare('UPDATE game_sessions SET state=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(state),room.id,room.revision).run();}
    }
    for(const id of roomIds)await addRoom(env,user,id,false);
    return response({linked});
   }
   if(path==='/api/account/beta/allowlist'){
    if(!isAdminEmail(env,user.email))return response({message:'Only a beta admin can manage the invite list.'},403);
    if(request.method==='GET'){
     const rows=await env.DB.prepare('SELECT email,note,created_at,created_by FROM beta_allowlist ORDER BY email').all();
     const admins=adminEmails(env);
     for(const email of admins){
      if(!rows.results.some(row=>row.email===email))rows.results.push({email,note:'Beta admin',created_at:0,created_by:'system'});
     }
     rows.results.sort((a,b)=>a.email.localeCompare(b.email));
     return response({emails:rows.results,admins});
    }
    if(request.method==='POST'){
     const input=await jsonBody(request,4096);
     const email=normalizeEmail(input.email);
     if(!emailOk(email))return response({message:'Enter a valid email address.'},400);
     const note=typeof input.note==='string'?input.note.trim().slice(0,120):'';
     await allowlistEmail(env,email,{note,createdBy:user.email});
     return response({ok:true,email,note});
    }
    if(request.method==='DELETE'){
     const input=await jsonBody(request,4096);
     const email=normalizeEmail(input.email);
     if(!emailOk(email))return response({message:'Enter a valid email address.'},400);
     if(isAdminEmail(env,email))return response({message:'Admin emails stay allowed via BETA_ADMIN_EMAILS and cannot be removed here.'},400);
     await env.DB.prepare('DELETE FROM beta_allowlist WHERE email=?').bind(email).run();
     return response({ok:true,email});
    }
    return response({message:'This beta action is unavailable.'},405);
   }
   if(path==='/api/account/beta/requests'){
    if(!isAdminEmail(env,user.email))return response({message:'Only a beta admin can review access requests.'},403);
    if(request.method==='GET'){
     const rows=await env.DB.prepare('SELECT id,email,name,message,status,created_at,reviewed_at,reviewed_by,review_note FROM beta_access_requests ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, created_at DESC LIMIT 200').all();
     return response({requests:rows.results.map(row=>({
      id:row.id,email:row.email,name:row.name,message:row.message,status:row.status,
      createdAt:row.created_at,reviewedAt:row.reviewed_at,reviewedBy:row.reviewed_by,reviewNote:row.review_note,
     }))});
    }
    if(request.method==='POST'){
     const input=await jsonBody(request,4096);
     const id=typeof input.id==='string'?input.id.trim():'';
     const action=input.action==='deny'?'deny':'approve';
     if(!/^[a-f0-9-]{36}$/i.test(id))return response({message:'Choose a request to review.'},400);
     const row=await env.DB.prepare('SELECT id,email,status FROM beta_access_requests WHERE id=?').bind(id).first();
     if(!row)return response({message:'That request was not found.'},404);
     if(row.status!=='pending')return response({message:'That request was already reviewed.'},400);
     const note=typeof input.note==='string'?input.note.trim().slice(0,120):'';
     const now=Date.now();
     if(action==='approve'){
      await allowlistEmail(env,row.email,{note:note||'Approved access request',createdBy:user.email});
      await env.DB.prepare("UPDATE beta_access_requests SET status='approved',reviewed_at=?,reviewed_by=?,review_note=? WHERE id=? AND status='pending'")
       .bind(now,user.email,note,id).run();
      return response({ok:true,id,status:'approved',email:row.email});
     }
     await env.DB.prepare("UPDATE beta_access_requests SET status='denied',reviewed_at=?,reviewed_by=?,review_note=? WHERE id=? AND status='pending'")
      .bind(now,user.email,note,id).run();
     return response({ok:true,id,status:'denied',email:row.email});
    }
    return response({message:'This beta action is unavailable.'},405);
   }
   if(path==='/api/account/beta/invites'){
    if(!isAdminEmail(env,user.email))return response({message:'Only a beta admin can manage invite links.'},403);
    if(request.method==='GET'){
     const rows=await env.DB.prepare('SELECT token_hash,label,created_at,created_by,expires_at,max_uses,use_count,revoked FROM beta_invites ORDER BY created_at DESC LIMIT 100').all();
     return response({invites:rows.results.map(row=>({
      id:row.token_hash.slice(0,12),
      label:row.label,
      createdAt:row.created_at,
      createdBy:row.created_by,
      expiresAt:row.expires_at,
      maxUses:row.max_uses,
      useCount:row.use_count,
      revoked:Boolean(row.revoked),
      remaining:row.max_uses>0?Math.max(0,row.max_uses-row.use_count):null,
     }))});
    }
    if(request.method==='POST'){
     const input=await jsonBody(request,4096);
     const label=typeof input.label==='string'?input.label.trim().slice(0,80):'';
     const maxUses=input.maxUses==null||input.maxUses===''?0:Number(input.maxUses);
     if(!Number.isInteger(maxUses)||maxUses<0||maxUses>1000)return response({message:'maxUses must be 0 (unlimited) or 1–1000.'},400);
     const days=input.days==null||input.days===''?30:Number(input.days);
     if(!Number.isFinite(days)||days<0||days>3650)return response({message:'days must be 0 (no expiry) or up to 3650.'},400);
     const raw=random().slice(0,40);
     const expiresAt=days>0?Date.now()+Math.round(days*86400000):null;
     await env.DB.prepare('INSERT INTO beta_invites(token_hash,label,created_at,created_by,expires_at,max_uses,use_count,revoked) VALUES (?,?,?,?,?,?,0,0)').bind(await sha(raw),label,Date.now(),user.email,expiresAt,maxUses).run();
     return response({ok:true,token:raw,label,maxUses,expiresAt,path:'#invite/'+raw});
    }
    if(request.method==='DELETE'){
     const input=await jsonBody(request,4096);
     const id=typeof input.id==='string'?input.id.trim().toLowerCase():'';
     if(!/^[a-f0-9]{8,64}$/.test(id))return response({message:'Choose an invite to revoke.'},400);
     const updated=await env.DB.prepare('UPDATE beta_invites SET revoked=1 WHERE substr(token_hash,1,?)=? AND revoked=0 RETURNING token_hash').bind(id.length,id).first();
     if(!updated)return response({message:'That invite was not found or is already revoked.'},404);
     return response({ok:true,id:updated.token_hash.slice(0,12)});
    }
    return response({message:'This beta action is unavailable.'},405);
   }
   const templateMatch=/^\/api\/account\/map-templates(?:\/([^/]+)(?:\/(.+?))?)?$/.exec(path);
   const templateArtMatch=/^\/api\/account\/map-templates\/([^/]+)\/(.+)\/artwork$/.exec(path);
   if(templateArtMatch){
    const module=decodeURIComponent(templateArtMatch[1]);
    const key=templateArtMatch[2].split('/').map(decodeURIComponent).join('/');
    if(!module||!key||module.length>64||key.length>512)return response({message:'Choose a valid map template.'},400);
    if(request.method==='GET'){
     const id=url.searchParams.get('id');
     const row=id
      ? await env.DB.prepare('SELECT a.content_type,a.body FROM map_template_assets a JOIN map_templates t ON t.artwork_id=a.artwork_id WHERE t.module=? AND t.map_key=? AND a.artwork_id=?').bind(module,key,id).first()
      : await env.DB.prepare('SELECT a.content_type,a.body FROM map_template_assets a JOIN map_templates t ON t.artwork_id=a.artwork_id WHERE t.module=? AND t.map_key=?').bind(module,key).first();
     return row?new Response(new Uint8Array(row.body),{headers:{'Content-Type':row.content_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}):response({message:'No artwork for this map template.'},404);
    }
    if(request.method==='PUT'){
     if(!isAdminEmail(env,user.email))return response({message:'Only a beta admin can upload map template artwork.'},403);
     const artworkId=request.headers.get('X-Artwork-Id');
     const blob=await boundedBody(request,16*1024*1024);
     if(!blob)return response({message:'The map image is too large.'},413);
     const image=new Blob([blob],{type:request.headers.get('Content-Type')||'application/octet-stream'});
     if(!/^[a-f0-9]{64}$/.test(artworkId??''))return response({message:'Choose a valid PNG, JPEG, or WebP map image.'},400);
     const typeOk=/^image\/(png|jpeg|webp)$/.test(image.type);
     const bytes=await image.arrayBuffer();
     const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
     if(!typeOk||digest!==artworkId)return response({message:'Choose a valid PNG, JPEG, or WebP map image.'},400);
     const now=Date.now();
     await env.DB.prepare('INSERT INTO map_template_assets(artwork_id,content_type,body,created_at,created_by) VALUES (?,?,?,?,?) ON CONFLICT(artwork_id) DO UPDATE SET content_type=excluded.content_type,body=excluded.body').bind(artworkId,image.type,bytes,now,user.email).run();
     const existing=await env.DB.prepare('SELECT data FROM map_templates WHERE module=? AND map_key=?').bind(module,key).first();
     let data={version:1,spawns:[],actors:[],features:[],notes:''};
     if(existing){try{data=JSON.parse(existing.data);}catch{/* keep blank */}}
     data.artworkId=artworkId;
     await env.DB.prepare('INSERT INTO map_templates(module,map_key,data,artwork_id,updated_at,updated_by) VALUES (?,?,?,?,?,?) ON CONFLICT(module,map_key) DO UPDATE SET data=excluded.data,artwork_id=excluded.artwork_id,updated_at=excluded.updated_at,updated_by=excluded.updated_by').bind(module,key,JSON.stringify(data),artworkId,now,user.email).run();
     return response({ok:true,artworkId});
    }
    return response({message:'This map template action is unavailable.'},405);
   }
   if(templateMatch){
    if(request.method==='GET'&&!templateMatch[1]){
     const rows=await env.DB.prepare('SELECT module,map_key,data,artwork_id,updated_at,updated_by FROM map_templates ORDER BY updated_at DESC LIMIT 500').all();
     return response({templates:rows.results.map(row=>{
      let notes='';
      try{notes=JSON.parse(row.data)?.notes||'';}catch{/* ignore */}
      return {module:row.module,mapKey:row.map_key,updatedAt:row.updated_at,updatedBy:row.updated_by,notes,hasArtwork:Boolean(row.artwork_id),artworkId:row.artwork_id||null};
     })});
    }
    const module=templateMatch[1]?decodeURIComponent(templateMatch[1]):'';
    const mapKey=templateMatch[2]?templateMatch[2].split('/').map(decodeURIComponent).join('/'):'';
    if(!module||!mapKey||module.length>64||mapKey.length>512)return response({message:'Choose a valid map template.'},400);
    if(request.method==='GET'){
     const row=await env.DB.prepare('SELECT module,map_key,data,artwork_id,updated_at,updated_by FROM map_templates WHERE module=? AND map_key=?').bind(module,mapKey).first();
     // Empty draft is normal — return 200 with template:null so the studio does not treat "new map" as an error.
     if(!row)return response({module,mapKey,template:null});
     let template;
     try{template=JSON.parse(row.data);}catch{return response({message:'This map template is corrupt.'},500);}
     if(row.artwork_id)template.artworkId=row.artwork_id;
     return response({module:row.module,mapKey:row.map_key,template,updatedAt:row.updated_at,updatedBy:row.updated_by});
    }
    if(request.method==='PUT'){
     if(!isAdminEmail(env,user.email))return response({message:'Only a beta admin can save map templates.'},403);
     const input=await jsonBody(request,600*1024);
     const template=input.template??input;
     if(!template||typeof template!=='object'||Array.isArray(template))return response({message:'Send a map template object.'},400);
     if(template.version!=null&&template.version!==1)return response({message:'Unsupported map template version.'},400);
     const encoded=JSON.stringify(template);
     if(new TextEncoder().encode(encoded).byteLength>512*1024)return response({message:'This map template exceeds the 512 KB limit.'},400);
     const artworkId=typeof template.artworkId==='string'&&/^[a-f0-9]{64}$/.test(template.artworkId)?template.artworkId:null;
     if(artworkId&&!await env.DB.prepare('SELECT artwork_id FROM map_template_assets WHERE artwork_id=?').bind(artworkId).first())
      return response({message:'Upload the map artwork before referencing it on this template.'},400);
     const now=Date.now();
     await env.DB.prepare('INSERT INTO map_templates(module,map_key,data,artwork_id,updated_at,updated_by) VALUES (?,?,?,?,?,?) ON CONFLICT(module,map_key) DO UPDATE SET data=excluded.data,artwork_id=COALESCE(excluded.artwork_id,map_templates.artwork_id),updated_at=excluded.updated_at,updated_by=excluded.updated_by').bind(module,mapKey,encoded,artworkId,now,user.email).run();
     const row=await env.DB.prepare('SELECT module,map_key,data,artwork_id,updated_at,updated_by FROM map_templates WHERE module=? AND map_key=?').bind(module,mapKey).first();
     const saved=JSON.parse(row.data);if(row.artwork_id)saved.artworkId=row.artwork_id;
     return response({ok:true,module:row.module,mapKey:row.map_key,template:saved,updatedAt:row.updated_at,updatedBy:row.updated_by});
    }
    if(request.method==='DELETE'){
     if(!isAdminEmail(env,user.email))return response({message:'Only a beta admin can delete map templates.'},403);
     await env.DB.prepare('DELETE FROM map_templates WHERE module=? AND map_key=?').bind(module,mapKey).run();
     return response({ok:true,module,mapKey});
    }
    return response({message:'This map template action is unavailable.'},405);
   }
   return response({message:'This account action is unavailable.'},405);
  }catch(error){return response({message:error instanceof SyntaxError?'The request could not be read.':error.message||'Account storage is temporarily unavailable.'},400);}
 }
 return {route,identity,roomOwner,addRoom,profile,verify,validWorkspace,closedBeta,isApproved,requireApproved,isAdminEmail};
})();
