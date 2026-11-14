import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createRunBudget } from '../../src/lib/server/compute-budget';
import { configSchema } from '../../src/lib/compute/config';
import { readLiveEvents } from '../../src/lib/compute/live-events';
const config=configSchema.parse({model:'test/model',measuredRequests:1,warmupRequests:0});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('atomic local run budget',()=>{
 it('rejects overlapping runs and enforces six reservations per hour, including failures',()=>{let now=0;const reserve=createRunBudget(()=>now);const release=reserve(config);expect(()=>reserve(config)).toThrow('already running');release();release();for(let i=0;i<5;i++)reserve(config)();expect(()=>reserve(config)).toThrow('hourly');now=3600001;expect(()=>reserve(config)()).not.toThrow();});
 it('reserves worst-case token and request budgets before provider work',()=>{const reserve=createRunBudget();const large={...config,measuredRequests:8,warmupRequests:2,maxOutputTokens:256};reserve(large)();reserve(large)();expect(()=>reserve(large)).toThrow('budget');});
});
describe('progress wire protocol',()=>{
 const response=(chunks:string[])=>new Response(new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(new TextEncoder().encode(chunk));c.close();}}),{headers:{'content-type':'application/x-ndjson'}});
 it('handles split lines and only exposes allowlisted activity, not output text',async()=>{const events:unknown[]=[];await readLiveEvents(response(['{"type":"pre','paring"}\n{"type":"activity","index":0,"outputBytes":12,"secret":"excluded"}\n','{"type":"report","report":{}}\n']),e=>{events.push(e);});expect(events).toEqual([{type:'preparing'},{type:'activity',index:0,outputBytes:12},{type:'report',report:{}}]);});
 it('rejects truncated, oversized and malformed streams',async()=>{await expect(readLiveEvents(response(['{"type":"preparing"}\n']),()=>{})).rejects.toThrow('before a report');await expect(readLiveEvents(response(['x'.repeat(300001)]),()=>{})).rejects.toThrow('size limit');await expect(readLiveEvents(response(['{"type":"invented"}\n']),()=>{})).rejects.toThrow();});
 it('rejects wrong content types and reports HTTP failures',async()=>{await expect(readLiveEvents(new Response('html'),()=>{})).rejects.toThrow('invalid response');await expect(readLiveEvents(Response.json({error:{message:'Budget reached'}},{status:429}),()=>{})).rejects.toThrow('Budget reached');});
});
it('caps hourly attempts separately from output tokens',()=>{const reserve=createRunBudget();const lowToken={...config,measuredRequests:8,warmupRequests:2,maxOutputTokens:16};for(let i=0;i<4;i++)reserve(lowToken)();expect(()=>reserve(lowToken)).toThrow('budget');});

it('keeps the 6000-token hourly ceiling when a manual retry reserves 512 tokens per request',()=>{const reserve=createRunBudget();const retry={...config,measuredRequests:3,warmupRequests:1,maxOutputTokens:512};reserve(retry)();reserve(retry)();expect(()=>reserve(retry)).toThrow('budget');});
