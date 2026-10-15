const KEY='pioneerAppointmentAccess';
const memory=new Map(),knownAliases=new Set();
let readError=false;
const valid=entry=>entry && typeof entry.id==='string' && /^(?:reserve|reverse)?[01]\d{8}-\d{2,}$/.test(entry.id) && /^[A-Za-z0-9_-]{43}$/.test(entry.accessToken || '');
export function savedAppointments() {
  try {
    const value=localStorage.getItem(KEY),entries=JSON.parse(value || '[]');
    if(!Array.isArray(entries))throw new Error('Invalid credential store');
    readError=false;
    for(const entry of entries.filter(valid).slice(0,100).reverse())if(!knownAliases.has(entry.id+'/'+entry.accessToken) && !memory.has(entry.id))memory.set(entry.id,entry);
  } catch {readError=true;}
  return [...memory.values()].reverse();
}
export const credentialStorageError=()=>readError;
export function saveAppointment(entry,previousId) {
  if(!valid(entry))return false;
  savedAppointments();
  if(previousId && previousId!==entry.id){knownAliases.add(previousId+'/'+entry.accessToken);if(memory.get(previousId)?.accessToken===entry.accessToken)memory.delete(previousId);}
  memory.delete(entry.id);memory.set(entry.id,{id:entry.id,accessToken:entry.accessToken});
  try {localStorage.setItem(KEY,JSON.stringify([...memory.values()].reverse().slice(0,100)));return true;}catch{return false;}
}
export function privateLink(entry) {
  const url=new URL('/',location.origin);url.hash=new URLSearchParams({appointment:entry.id,access:entry.accessToken}).toString();return url.href;
}
export function parsePrivateLink(value) {
  try {
    const url=new URL(value);
    if(url.origin!==location.origin || url.pathname!=='/' || url.search || url.username || url.password)return null;
    const params=new URLSearchParams(url.hash.slice(1));
    if([...params.keys()].length!==2 || !params.has('appointment') || !params.has('access'))return null;
    const entry={id:params.get('appointment'),accessToken:params.get('access')};return valid(entry) ? entry : null;
  } catch{return null;}
}
export const credentialHeaders=entry=>({'X-Appointment-Token':entry.accessToken});
export async function copyPrivateLink(entry,input,onMessage) {
  const link=privateLink(entry);input.value=link;
  try {await navigator.clipboard.writeText(link);onMessage?.('私人查询链接已复制，请妥善保存。');}
  catch {input.hidden=false;input.focus();input.select();onMessage?.('请复制选中的完整私人查询链接。');}
}
