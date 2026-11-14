import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { POST } from '../../src/app/api/benchmarks/route';
import { GET } from '../../src/app/api/benchmarks/models/route';
import { validateReport } from '../../src/lib/compute/report';
import { reportCommitments } from '../../src/lib/server/compute-report';
import { inspectReport } from '../../src/lib/compute/report-browser';
import { chunk } from './helpers';

// Exercises production composition with only fetch/env mocked. The route uses
// its live marker here; these test-only objects are never real benchmark data.
const model={id:'llama-3.3-70b-versatile',active:true,context_window:131072,max_completion_tokens:32768};
const origin='http://localhost:3100';
const input={model:model.id,measuredRequests:1,warmupRequests:0,maxOutputTokens:16};
const post=(extra:Record<string,unknown>={})=>new Request(`${origin}/api/benchmarks`,{method:'POST',headers:{host:'localhost:3100',origin,'content-type':'application/json'},body:JSON.stringify({...input,...extra})});
const get=()=>new Request(`${origin}/api/benchmarks/models`,{headers:{host:'localhost:3100','sec-fetch-site':'same-origin'}});
beforeEach(()=>{
 vi.stubEnv('VEYRA_COMPUTE_PROVIDER','groq');vi.stubEnv('GROQ_API_KEY','mock-groq-secret');vi.stubEnv('NEAR_AI_API_KEY','mock-near-unused');vi.stubEnv('GROQ_FREE_TIER_CONFIRMED','true');
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('Groq routes — no real network or inference',()=>{
 it('discovers real endpoint metadata and returns provider-aware status to existing controls',async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[model]}));vi.stubGlobal('fetch',request);
  const response=await GET(get());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({provider:'groq',available:true,models:[{id:model.id,maxOutputTokens:256}],message:expect.stringContaining('Groq')});
  expect(request).toHaveBeenCalledExactlyOnceWith('https://api.groq.com/openai/v1/models',expect.objectContaining({headers:{Authorization:'Bearer mock-groq-secret'}}));
 });
 it('pins the selected provider through inference and exports a valid committed report',async()=>{
  const request=vi.fn<typeof fetch>().mockImplementation(async url=>{
   if(String(url).endsWith('/models')){vi.stubEnv('VEYRA_COMPUTE_PROVIDER','near-ai-cloud');return Response.json({data:[model]});}
   const events=[chunk('private output',null,{model:model.id}),chunk(null,'stop',{model:model.id,x_groq:{usage:{completion_tokens:4}}})];
   return new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  });vi.stubGlobal('fetch',request);
  const response=await POST(post());const text=await response.text();const events=text.trim().split('\n').map(x=>JSON.parse(x));
  const report=validateReport(events.at(-1).report);expect(report).toMatchObject({origin:'live',schemaVersion:2,config:{provider:'groq',model:model.id},statistics:{successful:1},verification:{notRequested:1}});
  expect(events.some(e=>e.type==='activity')).toBe(true);expect(text).not.toMatch(/mock-groq-secret|mock-near-unused|private output/);
  expect(request.mock.calls.map(c=>c[0])).toEqual(['https://api.groq.com/openai/v1/models','https://api.groq.com/openai/v1/chat/completions']);
  expect(request.mock.calls[1][1]).toMatchObject({headers:{Authorization:'Bearer mock-groq-secret'}});
  expect((await inspectReport(JSON.stringify(report))).commitments).toEqual(reportCommitments(report));
 });
 it('returns a failed report and Groq rate-limit warning without retries or a provider fallback',async()=>{
  const request=vi.fn<typeof fetch>().mockImplementation(async url=>String(url).endsWith('/models')?Response.json({data:[model]}):Response.json({error:{message:'private mock-groq-secret'}},{status:429}));vi.stubGlobal('fetch',request);
  const events=(await(await POST(post({measuredRequests:3}))).text()).trim().split('\n').map(x=>JSON.parse(x));
  expect(events.at(-1)).toMatchObject({type:'report',warning:expect.stringContaining('Groq rate-limited'),report:{status:'provider_error',config:{provider:'groq'}}});
  expect(events.at(-1).report.requests.map((r:{status:string})=>r.status)).toEqual(['failed','skipped','skipped']);expect(request).toHaveBeenCalledTimes(2);expect(JSON.stringify(events)).not.toContain('mock-groq-secret');
 });
 it.each(['key','free-plan','provider'])('blocks missing/invalid %s before any request',async setting=>{
  const request=vi.fn<typeof fetch>();vi.stubGlobal('fetch',request);
  if(setting==='key')vi.stubEnv('GROQ_API_KEY','');else if(setting==='free-plan')vi.stubEnv('GROQ_FREE_TIER_CONFIRMED','false');else vi.stubEnv('VEYRA_COMPUTE_PROVIDER','typo');
  const response=await POST(post());expect(response.status).toBe(503);expect(await response.text()).toContain('No inference requests were sent');
  expect((await GET(get())).status).toBe(503);expect(request).not.toHaveBeenCalled();
 });
 it('rejects client provider/credential/endpoint overrides and cross-origin access',async()=>{
  const request=vi.fn<typeof fetch>();vi.stubGlobal('fetch',request);
  for(const extra of [{provider:'near-ai-cloud'},{apiKey:'CLIENT-SECRET'},{baseUrl:'https://example.test'}])expect((await POST(post(extra))).status).toBe(400);
  const cross=get();cross.headers.set('origin','https://example.test');expect((await GET(cross)).status).toBe(403);expect(request).not.toHaveBeenCalled();
 });
});
