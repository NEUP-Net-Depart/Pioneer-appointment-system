const KEY='pioneerStudentBookingDraft',ATTEMPT='pioneerStudentBookingAttempt',TTL=2*60*60*1000;
export function readDraft(){try{const draft=JSON.parse(sessionStorage.getItem(KEY) || 'null');if(!draft || typeof draft.savedAt!=='number' || !Number.isFinite(draft.savedAt) || Date.now()-draft.savedAt<0 || Date.now()-draft.savedAt>TTL || !draft.fields || typeof draft.fields!=='object' || Array.isArray(draft.fields) || Object.values(draft.fields).some(value=>typeof value!=='string')){sessionStorage.removeItem(KEY);return null;}return draft;}catch{return null;}}
export function writeDraft(fields,step){try{sessionStorage.setItem(KEY,JSON.stringify({fields,step,savedAt:Date.now()}));return true;}catch{return false;}}
export function clearDraft(){try{sessionStorage.removeItem(KEY);}catch{/* Session-only recovery is best effort. */}}
export function requestKey(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function readAttempt(){try{const attempt=JSON.parse(sessionStorage.getItem(ATTEMPT) || 'null');return /^[A-Za-z0-9_-]{43}$/.test(attempt?.key || '') ? attempt : null;}catch{return null;}}
export function writeAttempt(attempt){try{sessionStorage.setItem(ATTEMPT,JSON.stringify(attempt));return true;}catch{return false;}}
export function clearAttempt(){try{sessionStorage.removeItem(ATTEMPT);}catch{/* Keep the credential in memory even if storage is unavailable. */}}
