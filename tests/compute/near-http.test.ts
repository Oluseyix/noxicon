import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createNearCloudAdapter, parseCatalog } from '../../src/lib/server/compute-near';
import { computeConfiguration, supportedRuntime } from '../../src/lib/server/compute-env';
import { readProviderEvents } from '../../src/lib/server/compute-sse';
import { configSchema, requestBody } from '../../src/lib/compute/config';
import { runBenchmark } from '../../src/lib/server/compute-runner';
import { validateReport } from '../../src/lib/compute/report';
import { chunk } from './helpers';
const key='test-server-only-secret';
const entry={id:'test/model',name:'Test model',max_output_length:512,input_modalities:['text'],output_modalities:['text'],supported_sampling_parameters:['temperature','top_p','max_tokens']};
const config=configSchema.parse({model:entry.id,measuredRequests:1,warmupRequests:0});
const signal=()=>new AbortController().signal;
function sse(parts:string[]){return new Response(new ReadableStream({start(c){for(const p of parts)c.enqueue(new TextEncoder().encode(p));c.close();}}),{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});}
const wire=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
async function collect(response:Response,s=signal()){const events=[];for await(const event of readProviderEvents(response.body!,s))events.push(event);return events;}
function provider(responses:Response[]){const request=vi.fn<typeof fetch>();for(const response of responses)request.mockResolvedValueOnce(response);return {request,...createNearCloudAdapter({request,credential:()=>key})};}
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
describe('NEAR OpenAI-compatible HTTP adapter — entirely mocked',()=>{
 it('filters catalog capabilities, deduplicates and never supplies a fallback model',()=>{
  expect(parseCatalog({data:[entry,entry,{...entry,id:'image',output_modalities:['image']},{...entry,id:'missing',max_output_length:undefined},{...entry,id:'not-ready',is_ready:false},{...entry,id:'sampling',supported_sampling_parameters:['max_tokens']}]})).toEqual([{id:entry.id,name:entry.name,maxOutputTokens:256}]);
  expect(parseCatalog({data:[]})).toEqual([]);expect(()=>parseCatalog({models:[]})).toThrow('invalid');
 });
 it('authenticates discovery and exactly one inference dispatch; never invokes verification',async()=>{
  const p=provider([Response.json({data:[entry]}),sse([wire(chunk('answer')),wire(chunk(null,'stop')),wire({id:'completion-test',choices:[],usage:{completion_tokens:4}}),'data: [DONE]\n\n'])]);
  const session=await p.prepareTransport(config,signal());
  const events=[];for await(const e of await session.transport.open(requestBody(config,0),signal()))events.push(e);
  expect(events).toHaveLength(3);expect(session.transport.verify).toBeUndefined();
  expect(p.request.mock.calls.map(c=>c[0])).toEqual(['https://cloud-api.near.ai/v1/models','https://cloud-api.near.ai/v1/chat/completions']);
  expect(p.request.mock.calls[0][1]).toMatchObject({headers:{Authorization:`Bearer ${key}`},cache:'no-store',redirect:'manual'});
  expect(JSON.parse(p.request.mock.calls[1][1]!.body as string)).toEqual(requestBody(config,0));session.close();
 });
 it('refreshes discovery without reusing another credential’s catalog',async()=>{let secret=key;const request=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({data:[entry]}));const p=createNearCloudAdapter({request,credential:()=>secret});await p.discoverModels();secret='rotated-server-secret';await p.discoverModels();expect(request.mock.calls[1][1]?.headers).toEqual({Authorization:'Bearer rotated-server-secret'});});
 it.each([401,403,402,429,404,400,422,500,503,504])('classifies HTTP %i without retrying or exposing error text',async status=>{
  const p=provider([Response.json({data:[entry]}),Response.json({error:{message:`private ${key} prompt`}}, {status})]);
  const session=await p.prepareTransport(config,signal());
  const r=await runBenchmark({...config,measuredRequests:3},session.transport);
  expect(r.requests[0].status).toBe(status===504?'timed_out':'failed');expect(r.requests.slice(1).map(r=>r.status)).toEqual(['skipped','skipped']);expect(r.status).toBe('provider_error');expect(p.request).toHaveBeenCalledTimes(2);expect(JSON.stringify(r)).not.toContain(key);expect(validateReport(r)).toEqual(r);session.close();
 });
 it('distinguishes insufficient quota from a transient rate limit',async()=>{const p=provider([Response.json({error:{code:'insufficient_quota',message:key}},{status:429})]);await expect(p.discoverModels()).rejects.toMatchObject({code:'insufficient_credits'});expect(p.request).toHaveBeenCalledTimes(1);});
 it('handles network failures and bad content types without a fallback request',async()=>{
  const request=vi.fn<typeof fetch>().mockRejectedValue(new TypeError(key));const p=createNearCloudAdapter({request,credential:()=>key});await expect(p.discoverModels()).rejects.toMatchObject({code:'network_error'});expect(request).toHaveBeenCalledTimes(1);
  const bad=provider([Response.json({data:[entry]}),Response.json({choices:[]})]);const session=await bad.prepareTransport(config,signal());await expect(session.transport.open(requestBody(config,0),signal())).rejects.toMatchObject({code:'invalid_provider_response'});session.close();
 });
 it('refuses stale models and excessive output limits before dispatch',async()=>{for(const settings of [{...config,model:'unknown/model'},{...config,maxOutputTokens:256}]){const p=provider([Response.json({data:[{...entry,max_output_length:128}]})]);await expect(p.prepareTransport(settings,signal())).rejects.toThrow();expect(p.request).toHaveBeenCalledTimes(1);}});
 it('cancels discovery immediately and sends no inference',async()=>{
  const controller=new AbortController();const request=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true})));
  const p=createNearCloudAdapter({request,credential:()=>key});const pending=p.prepareTransport(config,controller.signal);controller.abort();await expect(pending).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
 });
 it('cancels a pending content read and never dispatches after cancellation',async()=>{
  const requestAbort=new AbortController(),cancel=vi.fn();const p=provider([Response.json({data:[entry]}),new Response(new ReadableStream({cancel}),{headers:{'content-type':'text/event-stream'}})]);
  const session=await p.prepareTransport(config,signal());const stream=await session.transport.open(requestBody(config,0),requestAbort.signal);const iterator=stream[Symbol.asyncIterator]();const next=iterator.next();requestAbort.abort();await expect(next).rejects.toThrow();expect(cancel).toHaveBeenCalled();await expect(session.transport.open(requestBody(config,0),requestAbort.signal)).rejects.toThrow();expect(p.request).toHaveBeenCalledTimes(2);session.close();
 });
 it('enforces the request deadline through actual HTTP stream consumption',async()=>{
  vi.useFakeTimers();const cancel=vi.fn();const p=provider([Response.json({data:[entry]}),new Response(new ReadableStream({cancel}),{headers:{'content-type':'text/event-stream'}})]);
  const session=await p.prepareTransport(config,signal());const pending=runBenchmark({...config,measuredRequests:2,requestTimeoutMs:1000},session.transport);await vi.advanceTimersByTimeAsync(1001);const r=await pending;expect(r.requests.map(r=>r.status)).toEqual(['timed_out','skipped']);expect(cancel).toHaveBeenCalled();expect(p.request).toHaveBeenCalledTimes(2);session.close();
 });
 it('rejects oversized catalogs and never leaks a reflected credential',async()=>{for(const body of [{data:[{...entry,name:key}]},{data:[],extra:'x'.repeat(1048577)}]){const p=provider([Response.json(body)]);await expect(p.discoverModels()).rejects.toMatchObject({code:'invalid_provider_response'});}});
});
describe('bounded SSE decoding',()=>{
 it('handles split UTF-8, CRLF, comments, multiline data and final usage',async()=>{
  const text=': heartbeat\r\ndata: {"id":"c",\r\ndata: "choices":[{"index":0,"delta":{"content":"é"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  const bytes=new TextEncoder().encode(text);const body=new ReadableStream<Uint8Array>({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}});
  const result=await collect(new Response(body));expect(result).toEqual([{id:'c',choices:[{index:0,delta:{content:'é'}}]}]);
 });
 it.each(['data: {bad}\n\n','data: {}\n\n','data: '+ 'x'.repeat(262145)+'\n\n'])('rejects malformed, truncated and oversized events',async text=>{await expect(collect(sse([text]))).rejects.toThrow('invalid');});
 it('sanitizes provider errors embedded in an HTTP 200 stream',async()=>{await expect(collect(sse(['event: error\ndata: {"error":{"code":"insufficient_quota","message":"PRIVATE"}}\n\n']))).rejects.toMatchObject({code:'insufficient_credits'});});
});
describe('server configuration',()=>{
 it('documents and enforces the declared runtime without importing the attestation SDK',()=>{expect(supportedRuntime('24.18.1')).toBe(false);expect(supportedRuntime('24.22.0')).toBe(false);expect(supportedRuntime('24.22.1')).toBe(true);expect(supportedRuntime('25.0.0')).toBe(true);});
 it('requires a server key without echoing it',()=>{vi.stubEnv('NEAR_AI_API_KEY','');expect(()=>computeConfiguration()).toThrow();vi.stubEnv('NEAR_AI_API_KEY','PRIVATE\nKEY');expect(()=>computeConfiguration()).toThrow();});
});
it('bounds model discovery independently of the inference deadline',async()=>{
 const deadline=new AbortController();const timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(deadline.signal);
 try{const request=vi.fn<typeof fetch>().mockImplementation((_u,init)=>new Promise((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true})));
 const p=createNearCloudAdapter({request,credential:()=>key});const pending=p.discoverModels();deadline.abort(new DOMException('Timeout','TimeoutError'));await expect(pending).rejects.toMatchObject({code:'provider_timeout'});expect(request).toHaveBeenCalledOnce();}finally{timeout.mockRestore();}
});
it('rejects malformed UTF-8 and enforces the entire SSE stream budget',async()=>{
 await expect(collect(new Response(new Uint8Array([0xff])))).rejects.toMatchObject({code:'invalid_provider_response'});
 await expect(collect(sse(Array.from({length:70},()=>':'+ 'x'.repeat(65000)+'\n\n')))).rejects.toMatchObject({code:'invalid_provider_response'});
});
