import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBody,HttpError} from '../src/lib/http.js';

test('JSON body limits reject oversized content with and without a declared length',async()=>{
  const body=JSON.stringify({padding:'x'.repeat(1024*1024)});
  for(const headers of [{},{'Content-Length':String(Buffer.byteLength(body))}]){
    const request=new Request('https://app.test/api/appointments',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
    await assert.rejects(()=>readBody(request),error=>error instanceof HttpError && error.status===413);
  }
});
