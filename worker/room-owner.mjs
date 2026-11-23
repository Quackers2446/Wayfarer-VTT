// This credential is never included in shared state, invitation URLs, or JavaScript storage.
const cookieName='__Host-wayfarer-owner';
const pattern=/^[a-f0-9]{64}$/;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export function ownerCredential(request){
  const matches=(request.headers.get('Cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));
  if(matches.length!==1)return null;
  const value=matches[0].slice(cookieName.length+1);
  return pattern.test(value)?value:null;
}
export async function ownerHash(request){
  const credential=ownerCredential(request);
  return credential?hashCredential(credential):null;
}
async function hashCredential(credential){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credential))));}
export async function newRoomOwner(request){
  const credential=ownerCredential(request)??hex(crypto.getRandomValues(new Uint8Array(32)));
  return {hash:await hashCredential(credential),cookie:`${cookieName}=${credential}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict`};
}
export function ownsRoom(stored,presented){
  if(!stored||!presented||!pattern.test(stored)||!pattern.test(presented))return false;
  let difference=0;for(let i=0;i<64;i++)difference|=stored.charCodeAt(i)^presented.charCodeAt(i);
  return difference===0;
}
