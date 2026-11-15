import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { createNearCloudAdapter } from '../../src/lib/server/compute-near';
import { createGroqAdapter, parseGroqCatalog } from '../../src/lib/server/compute-groq';
import { computeConfiguration, selectedProvider } from '../../src/lib/server/compute-env';
import { configSchema, requestBody } from '../../src/lib/compute/config';
import { runBenchmark } from '../../src/lib/server/compute-runner';
import { validateReport, reportCommitments, constructBenchmarkReceipt } from '../../src/lib/server/compute-report';
import { inspectReport } from '../../src/lib/compute/report-browser';
import { statistics, verificationSummary } from '../../src/lib/compute/metrics';
import { chunk } from './helpers';

const key='mock-only-cloud-secret';
const groqModel={id:'llama-3.3-70b-versatile',active:true,context_window:131072,max_completion_tokens:32768};
const nearModel={id:'test/model',max_output_length:512,input_modalities:['text'],output_modalities:['text'],supported_sampling_parameters:['temperature','top_p','max_tokens']};
const providers=[
 {id:'near-ai-cloud' as const,name:'NEAR AI Cloud',base:'https://cloud-api.near.ai/v1/',entry:nearModel,create:createNearCloudAdapter},
 {id:'groq' as const,name:'Groq',base:'https://api.groq.com/openai/v1/',entry:groqModel,create:createGroqAdapter},
];
const signal=()=>new AbortController().signal;
const wire=(event:unknown)=>`data: ${JSON.stringify(event)}\n\n`;
function sse(events:unknown[],end=true){
 return new Response(events.map(wire).join('')+(end?'data: [DONE]\n\n':''),{headers:{'content-type':'text/event-stream'}});
}
function success(model:string,usage=true){return sse([chunk('private answer',null,{model}),chunk(null,'stop',{model}),...(usage?[{id:'completion-test',model,choices:[],usage:{completion_tokens:4}}]:[])]);}
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();vi.restoreAllMocks();});

describe.each(providers)('$name shared cloud contract — HTTP fixtures, no real inference',provider=>{
 const config=configSchema.parse({model:provider.entry.id,warmupRequests:0,measuredRequests:1,maxOutputTokens:32});
 function adapter(responses:Response[]){
  const request=vi.fn<typeof fetch>();for(const response of responses)request.mockResolvedValueOnce(response);
  return {request,...provider.create({request,credential:()=>key})};
 }
 it('records provider/model, truthful fixture provenance, timings and canonical commitments',async()=>{
  const p=adapter([Response.json({data:[provider.entry]}),success(config.model)]);
  const session=await p.prepareTransport(config,signal());const report=await runBenchmark(config,session.transport);
  expect(report).toMatchObject({schemaVersion:2,origin:'test-fixture',config:{provider:provider.id,model:config.model},statistics:{successful:1},verification:{notRequested:1,providerTee:0,gpuTee:0}});
  expect(report.requests[0]).toMatchObject({status:'success',outputTokens:4,tokenSource:'reported',verificationMs:null});
  expect(report.requests[0].latencyMs).toBeGreaterThanOrEqual(report.requests[0].ttftMs!);
  expect(report.requests[0].throughputTokensPerSecond).toBeCloseTo(4000/report.requests[0].latencyMs!);
  expect(validateReport(report)).toEqual(report);expect((await inspectReport(JSON.stringify(report))).commitments).toEqual(reportCommitments(report));
  expect(JSON.stringify(report)).not.toMatch(/mock-only-cloud-secret|private answer/);
  expect(session.transport.verify).toBeUndefined();expect(()=>constructBenchmarkReceipt(report)).toThrow('not enabled');
  expect(p.request.mock.calls.map(c=>c[0])).toEqual([`${provider.base}models`,`${provider.base}chat/completions`]);
  for(const [,init] of p.request.mock.calls)expect(init).toMatchObject({headers:{Authorization:`Bearer ${key}`},redirect:'manual',cache:'no-store'});
  const body=JSON.parse(p.request.mock.calls[1][1]!.body as string);
  const original=requestBody(config,0);
  if(provider.id==='groq'){
   const {max_tokens,...rest}=original;expect(body).toEqual({...rest,max_completion_tokens:max_tokens,service_tier:'on_demand'});
  }else expect(body).toEqual(original);
  session.close();
 });
 it.each([301,302,303,307,308])('rejects HTTP %s on discovery and completion without following redirects',async status=>{
  for(const operation of ['models','completion']){
   const cancel=vi.fn();
   const redirect=new Response(new ReadableStream({cancel}),{status,headers:{Location:'https://untrusted.example/collect'}});
   const p=adapter(operation==='models'?[redirect]:[Response.json({data:[provider.entry]}),redirect]);
   if(operation==='models')await expect(p.discoverModels(signal())).rejects.toMatchObject({code:'network_error',provider:provider.id});
   else{
    const session=await p.prepareTransport(config,signal());
    try{await expect(session.transport.open(requestBody(config,0),signal())).rejects.toMatchObject({code:'network_error',provider:provider.id});}
    finally{session.close();}
   }
   expect(cancel).toHaveBeenCalledOnce();
   expect(p.request).toHaveBeenCalledTimes(operation==='models'?1:2);
   for(const [url,init] of p.request.mock.calls){expect(String(url).startsWith(provider.base)).toBe(true);expect(init?.redirect).toBe('manual');}
  }
 });
 it('does not invent tokens when usage is absent',async()=>{
  const p=adapter([Response.json({data:[provider.entry]}),success(config.model,false)]);
  const session=await p.prepareTransport(config,signal());const report=await runBenchmark(config,session.transport);
  expect(validateReport(report).requests[0]).toMatchObject({status:'success',tokenSource:'unavailable',outputTokens:null,throughputTokensPerSecond:null});session.close();
 });
 it.each([
  [401,undefined,'invalid_credentials'],[403,undefined,'invalid_credentials'],[402,undefined,'insufficient_credits'],
  [429,undefined,'provider_rate_limit'],[429,'insufficient_quota','insufficient_credits'],[404,undefined,'model_unavailable'],
  [400,'model_decommissioned','model_unavailable'],[400,undefined,'provider_rejected_request'],[422,undefined,'provider_rejected_request'],
  [500,undefined,'provider_unavailable'],[503,undefined,'provider_unavailable'],[504,undefined,'timeout'],
 ])('stops after HTTP %s (%s), safely reporting %s without retries',async(status,code,expected)=>{
  const p=adapter([Response.json({data:[provider.entry]}),Response.json({error:{code,message:`PRIVATE ${key}`}},{status:Number(status)})]);
  const session=await p.prepareTransport(config,signal());const issue=vi.fn();
  const report=await runBenchmark({...config,measuredRequests:3},session.transport,{onIssue:issue});
  expect(report.status).toBe('provider_error');expect(report.requests[0].errorCode).toBe(expected);expect(report.requests.slice(1).map(r=>r.status)).toEqual(['skipped','skipped']);
  expect(issue.mock.calls[0][0].message).toContain(provider.name);expect(JSON.stringify(issue.mock.calls)).not.toContain(key);
  expect(validateReport(report).config.provider).toBe(provider.id);expect(p.request).toHaveBeenCalledTimes(2);session.close();
 });
 it('handles a rate-limit event inside HTTP 200 and does not retry',async()=>{
  const p=adapter([Response.json({data:[provider.entry]}),sse([{error:{code:'rate_limit_exceeded',message:key}}])]);
  const session=await p.prepareTransport(config,signal());const issue=vi.fn();
  const report=await runBenchmark({...config,measuredRequests:2},session.transport,{onIssue:issue});
  expect(report.requests[0].errorCode).toBe('provider_rate_limit');expect(issue.mock.calls[0][0].message).toContain(provider.name);expect(p.request).toHaveBeenCalledTimes(2);session.close();
 });
 it.each(['truncated','wrong-model','wrong-content-type','empty-output','reflected-key'])('halts scheduling on %s instead of fabricating success',async kind=>{
  const response=kind==='truncated'?sse([chunk('answer')],false):kind==='wrong-model'?success('different/model'):
   kind==='wrong-content-type'?Response.json({private:key}):kind==='empty-output'?sse([chunk(null,'stop')]):sse([chunk('answer',null,{id:key})]);
  const p=adapter([Response.json({data:[provider.entry]}),response]);const session=await p.prepareTransport(config,signal());const issue=vi.fn();
  const report=await runBenchmark({...config,measuredRequests:2},session.transport,{onIssue:issue});
  expect(report.requests.map(r=>r.status)).toEqual(['failed','skipped']);expect(report.statistics.successful).toBe(0);
  expect(issue.mock.calls[0][0].message).toContain(provider.name);expect(issue.mock.calls[0][0].message).toContain(kind==='empty-output'?'without answer content':'invalid or incomplete response');expect(JSON.stringify(report)).not.toContain(key);expect(p.request).toHaveBeenCalledTimes(2);session.close();
 });
 it('rejects a stale model before any inference and does not switch providers',async()=>{
  const p=adapter([Response.json({data:[]})]);await expect(p.prepareTransport(config,signal())).rejects.toMatchObject({code:'model_unavailable',provider:provider.id});expect(p.request).toHaveBeenCalledOnce();
 });
 it('bounds discovery time and cancels without inference',async()=>{
  const deadline=new AbortController();vi.spyOn(AbortSignal,'timeout').mockReturnValue(deadline.signal);
  const request=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true})));
  const p=provider.create({request,credential:()=>key});const pending=p.discoverModels();deadline.abort(new DOMException('timeout','TimeoutError'));
  await expect(pending).rejects.toMatchObject({code:'provider_timeout',provider:provider.id});expect(request).toHaveBeenCalledOnce();
 });
 it('rejects excessive output limits and reflected credentials before inference',async()=>{
  const limited=provider.id==='groq'?{...provider.entry,max_completion_tokens:16}:{...provider.entry,max_output_length:16};
  const p=adapter([Response.json({data:[limited]})]);await expect(p.prepareTransport(config,signal())).rejects.toThrow('output limit');expect(p.request).toHaveBeenCalledOnce();
  const reflected={...provider.entry,id:provider.id==='groq'?`llama-${key}`:key};const secret=adapter([Response.json({data:[reflected]})]);
  await expect(secret.discoverModels()).rejects.toMatchObject({code:'invalid_provider_response',provider:provider.id});expect(secret.request).toHaveBeenCalledOnce();
 });
 it('preserves sequential warm-ups and the exact concurrency/request budget over HTTP',async()=>{
  let active=0,maxActive=0,dispatches=0,warmupOverlap=false;
  const request=vi.fn<typeof fetch>().mockImplementation(async url=>{
   if(String(url).endsWith('/models'))return Response.json({data:[provider.entry]});
   dispatches++;active++;maxActive=Math.max(maxActive,active);if(dispatches<=2&&active>1)warmupOverlap=true;
   return new Response(new ReadableStream({start(controller){setTimeout(()=>{
    controller.enqueue(new TextEncoder().encode(wire(chunk('answer'))+wire(chunk(null,'stop'))+'data: [DONE]\n\n'));active--;controller.close();
   },5);}}),{headers:{'content-type':'text/event-stream'}});
  });
  const p=provider.create({request,credential:()=>key});const session=await p.prepareTransport(config,signal());
  const report=await runBenchmark({...config,warmupRequests:2,measuredRequests:4,concurrency:2},session.transport);
  expect(maxActive).toBe(2);expect(warmupOverlap).toBe(false);expect(dispatches).toBe(6);expect(report.requests.map(r=>r.phase)).toEqual(['warmup','warmup','measured','measured','measured','measured']);
  expect(validateReport(report).statistics.successful).toBe(4);expect(request).toHaveBeenCalledTimes(7);session.close();
 });
 it('sanitizes a network failure and sends no second request',async()=>{
  const request=vi.fn<typeof fetch>().mockRejectedValue(new TypeError(key));const p=provider.create({request,credential:()=>key});
  await expect(p.discoverModels()).rejects.toMatchObject({code:'network_error',provider:provider.id});expect(request).toHaveBeenCalledOnce();
 });
 it('aborts active stream reads and prevents subsequent dispatches',async()=>{
  const cancel=vi.fn(),abort=new AbortController();
  const p=adapter([Response.json({data:[provider.entry]}),new Response(new ReadableStream({cancel}),{headers:{'content-type':'text/event-stream'}})]);
  const session=await p.prepareTransport(config,abort.signal);const pending=runBenchmark({...config,measuredRequests:2},session.transport,{signal:abort.signal});
  await vi.waitFor(()=>expect(p.request).toHaveBeenCalledTimes(2));abort.abort();const report=await pending;
  expect(report.status).toBe('cancelled');expect(report.requests.map(r=>r.status)).toEqual(['cancelled','skipped']);expect(cancel).toHaveBeenCalledOnce();
  expect(validateReport(report).config.provider).toBe(provider.id);await expect(session.transport.open(requestBody(config,0),signal())).rejects.toThrow();expect(p.request).toHaveBeenCalledTimes(2);session.close();
 });
 it('closes a response cancelled after open but before iterator consumption',async()=>{
  const cancel=vi.fn();const p=adapter([Response.json({data:[provider.entry]}),new Response(new ReadableStream({cancel}),{headers:{'content-type':'text/event-stream'}})]);
  const session=await p.prepareTransport(config,signal());await session.transport.open(requestBody(config,0),signal());session.close();
  expect(cancel).toHaveBeenCalledOnce();expect(p.request).toHaveBeenCalledTimes(2);
 });
 it('enforces the request deadline without launching a replacement request',async()=>{
  vi.useFakeTimers();const cancel=vi.fn();
  const p=adapter([Response.json({data:[provider.entry]}),new Response(new ReadableStream({cancel}),{headers:{'content-type':'text/event-stream'}})]);
  const session=await p.prepareTransport(config,signal());const pending=runBenchmark({...config,measuredRequests:2,requestTimeoutMs:1000},session.transport);
  await vi.advanceTimersByTimeAsync(1001);const report=await pending;expect(report.requests.map(r=>r.status)).toEqual(['timed_out','skipped']);expect(cancel).toHaveBeenCalledOnce();expect(p.request).toHaveBeenCalledTimes(2);session.close();
 });
 it('rejects provider tampering, invented attestation and extra credentials in reports',async()=>{
  const p=adapter([Response.json({data:[provider.entry]}),success(config.model)]);const session=await p.prepareTransport(config,signal());const report=await runBenchmark(config,session.transport);
  const hashes=reportCommitments(report);const changed=structuredClone(report);changed.config={...changed.config,provider:provider.id==='groq'?'near-ai-cloud':'groq'};
  expect(reportCommitments(changed).configurationCommitment).not.toBe(hashes.configurationCommitment);expect(reportCommitments(changed).reportCommitment).not.toBe(hashes.reportCommitment);
  expect(()=>validateReport({...report,config:{...report.config,provider:'invented'}})).toThrow();expect(()=>validateReport({...report,config:{...report.config,apiKey:key}})).toThrow();
  changed.requests[0].verification={status:'provider_tee',reason:'verified',modelTeeVerified:true,gpuTeeVerified:true};changed.requests[0].verificationMs=1;
  changed.statistics=statistics(changed.requests);changed.verification=verificationSummary(changed.requests);expect(()=>validateReport(changed)).toThrow('cannot claim attestation');session.close();
 });
});

describe('Groq catalog and stream dialect',()=>{
 it.each(['length','stop'] as const)('explains a reasoning-only warm-up ending in %s without retrying',async finish=>{
  const model={...groqModel,id:'openai/gpt-oss-120b'};
  const request=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({data:[model]})).mockResolvedValueOnce(sse([
   chunk(null,null,{choices:[{index:0,delta:{reasoning:'Synthetic reasoning'},finish_reason:null}]}),
   chunk(null,finish,{x_groq:{usage:{completion_tokens:96,completion_tokens_details:{reasoning_tokens:96}}}}),
  ]));
  const adapter=createGroqAdapter({request,credential:()=>key});
  const config=configSchema.parse({model:model.id,warmupRequests:1,measuredRequests:3,maxOutputTokens:96});
  const session=await adapter.prepareTransport(config,signal()),issue=vi.fn();
  try{
   const report=await runBenchmark(config,session.transport,{onIssue:issue});
   expect(validateReport(report).statistics).toMatchObject({attempted:0,successful:0,failed:0,skipped:3});
   expect(report.requests[0]).toMatchObject({phase:'warmup',status:'failed',errorCode:'empty_output',finishReason:finish,ttftMs:null,outputBytes:0});
   expect(report.requests[0].latencyMs).not.toBeNull();
   expect(report.requests.slice(1).every(r=>r.status==='skipped'&&r.errorCode==='not_started'&&r.latencyMs===null)).toBe(true);
   expect(issue).toHaveBeenCalledOnce();
   const message=issue.mock.calls[0][0].message;
   expect(message).toContain('Groq returned a completed stream without answer content.');
   expect(message).toContain('No automatic retry was made.');
   expect(message.includes('may have been exhausted')).toBe(finish==='length');
   expect(message).not.toContain('invalid or incomplete');
   expect(message).toContain('Provider completion tokens: 96; reasoning tokens: 96.');
   expect(message).not.toContain('Synthetic reasoning');
   expect(message.length).toBeLessThanOrEqual(500);
   expect(report.requests[0].outputTokens).toBeNull();
   expect(report.statistics.latencyMs.samples).toBe(0);
   expect(request).toHaveBeenCalledTimes(2);
   expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toMatchObject({max_completion_tokens:96});
  }finally{session.close();}
 });
 it('accepts GPT-OSS reasoning followed by answer content without warnings',async()=>{
  const model={...groqModel,id:'openai/gpt-oss-20b'};
  const request=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({data:[model]})).mockResolvedValueOnce(sse([
   chunk(null,null,{choices:[{index:0,delta:{reasoning:'Synthetic reasoning'}}]}),chunk('answer'),chunk(null,'length',{x_groq:{usage:{completion_tokens:96}}}),
  ]));
  const adapter=createGroqAdapter({request,credential:()=>key});const config=configSchema.parse({model:model.id,warmupRequests:0,measuredRequests:1});
  const session=await adapter.prepareTransport(config,signal()),issue=vi.fn();
  try{const report=await runBenchmark(config,session.transport,{onIssue:issue});expect(validateReport(report).requests[0]).toMatchObject({status:'success',outputBytes:6,outputTokens:96,finishReason:'length'});expect(issue).not.toHaveBeenCalled();}finally{session.close();}
 });

 it('rejects Groq stream error metadata even alongside a normal finish marker',async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({data:[groqModel]})).mockResolvedValueOnce(sse([
   chunk('answer'),chunk(null,'stop',{x_groq:{error:`private ${key}`}}),
  ]));
  const p=createGroqAdapter({request,credential:()=>key});const config=configSchema.parse({model:groqModel.id,measuredRequests:2,warmupRequests:0});const session=await p.prepareTransport(config,signal());const report=await runBenchmark(config,session.transport);
  expect(report.requests.map(r=>r.status)).toEqual(['failed','skipped']);expect(report.requests[0].errorCode).toBe('invalid_provider_response');expect(JSON.stringify(report)).not.toContain(key);expect(request).toHaveBeenCalledTimes(2);session.close();
 });
 it('discovers only returned compatible chat entries, deduplicates and has no fallback catalog',()=>{
  const data=[groqModel,groqModel,{...groqModel,id:'whisper-large-v3'},{...groqModel,id:'groq/compound'},
   {...groqModel,id:'meta-llama/llama-guard-4-12b'},{...groqModel,id:'openai/gpt-oss-safeguard-20b'},
   {...groqModel,id:'qwen/qwen3-32b',active:false},{id:'llama-incomplete'},
   {...groqModel,id:'llama-too-small',max_completion_tokens:8}];
  expect(parseGroqCatalog({data})).toEqual([{id:groqModel.id,name:groqModel.id,maxOutputTokens:512}]);
  expect(parseGroqCatalog({data:[]})).toEqual([]);expect(()=>parseGroqCatalog({models:data})).toThrow('invalid');
  expect(parseGroqCatalog({data:[{...groqModel,max_completion_tokens:64}]})[0]).toHaveProperty('maxOutputTokens',64);
  expect(parseGroqCatalog({data:[{...groqModel,max_completion_tokens:undefined}]})[0]).toHaveProperty('maxOutputTokens',256);
 });
 it.each([false,true])('handles x_groq usage and rejects conflicting standard usage (conflict=%s)',async conflict=>{
  const request=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({data:[groqModel]})).mockResolvedValueOnce(sse([
   chunk('answer',null,{model:groqModel.id}),chunk(null,'stop',{x_groq:{usage:{completion_tokens:7}},...(conflict?{usage:{completion_tokens:8}}:{})}),
  ]));
  const p=createGroqAdapter({request,credential:()=>key});const config=configSchema.parse({model:groqModel.id,measuredRequests:1,warmupRequests:0});const session=await p.prepareTransport(config,signal());const report=await runBenchmark(config,session.transport);
  expect(report.requests[0].status).toBe(conflict?'failed':'success');expect(report.requests[0].outputTokens).toBe(conflict?null:7);expect(validateReport(report)).toEqual(report);session.close();
 });
});

describe('server-only provider configuration',()=>{
 it('defaults to NEAR and rejects typos rather than switching provider',()=>{
  vi.stubEnv('VEYRA_COMPUTE_PROVIDER',undefined);expect(selectedProvider()).toBe('near-ai-cloud');
  vi.stubEnv('VEYRA_COMPUTE_PROVIDER','groq');expect(selectedProvider()).toBe('groq');
  vi.stubEnv('VEYRA_COMPUTE_PROVIDER','typo');expect(()=>selectedProvider()).toThrow('VEYRA_COMPUTE_PROVIDER');
 });
 it('requires Groq credentials and explicit free-tier confirmation, never using a NEAR key',()=>{
  vi.stubEnv('VEYRA_COMPUTE_PROVIDER','groq');vi.stubEnv('NEAR_AI_API_KEY','unused-near-key');vi.stubEnv('GROQ_API_KEY','');
  expect(()=>computeConfiguration()).toThrow('GROQ_API_KEY');vi.stubEnv('GROQ_API_KEY',key);vi.stubEnv('GROQ_FREE_TIER_CONFIRMED','false');
  expect(()=>computeConfiguration()).toThrow('free-tier');vi.stubEnv('GROQ_FREE_TIER_CONFIRMED','true');expect(computeConfiguration()).toBe(key);
  vi.stubEnv('GROQ_API_KEY','SECRET\nKEY');expect(()=>computeConfiguration()).toThrow('GROQ_API_KEY');
  expect(computeConfiguration('near-ai-cloud')).toBe('unused-near-key');
 });
});
