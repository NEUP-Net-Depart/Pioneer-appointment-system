import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBody,HttpError} from '../src/lib/http.ts';

test('JSON body limits reject oversized content with and without a declared length',async()=>{
  const body=JSON.stringify({padding:'x'.repeat(1024*1024)});
  const lengths: Record<string, string>[] = [{},{'Content-Length':String(Buffer.byteLength(body))}];
  for(const headers of lengths){
    const request=new Request('https://app.test/api/appointments',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
    await assert.rejects(()=>readBody(request),error=>error instanceof HttpError && error.status===413);
  }
});
