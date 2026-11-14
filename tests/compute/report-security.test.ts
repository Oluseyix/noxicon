import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { runBenchmark } from '../../src/lib/server/compute-runner';
import { benchmarkReceiptSchema, canonicalJson, constructBenchmarkReceipt, digest, reportCommitments, validateReport } from '../../src/lib/server/compute-report';
import { POST } from '../../src/app/api/benchmarks/route';
import { POST as retired } from '../../src/app/api/ai/explain/route';
import { statistics } from '../../src/lib/compute/metrics';
import { config, fixture } from './helpers';
const req=(body:unknown,extra:Record<string,string>={})=>new Request('http://localhost:3000/api/benchmarks',{method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json',...extra},body:JSON.stringify(body)});
async function report(){const f=fixture();return runBenchmark(config,f.transport,f.options);}
describe('canonical benchmark report and receipt construction',()=>{
  it('canonicalizes nested keys, preserves array order and commits fractional timings',()=>{
    expect(canonicalJson({z:[2,1],a:{y:0.25,x:2}})).toBe(canonicalJson({a:{x:2,y:0.25},z:[2,1]}));
    expect(digest('result',[2,1])).not.toBe(digest('result',[1,2]));expect(digest('result',1)).not.toBe(digest('configuration',1));
  });
  it.each([NaN,Infinity,undefined,1n,new Date(),[undefined],new Array(1)])('rejects unsupported canonical values',value=>expect(()=>canonicalJson(value)).toThrow());
  it('rejects cyclic values',()=>{const value:Record<string,unknown>={};value.self=value;expect(()=>canonicalJson(value)).toThrow('Cyclic');});
  it('reproduces report hashes after JSON export and detects changed configuration and results',async()=>{
    const r=await report(),hashes=reportCommitments(r);expect(reportCommitments(JSON.parse(JSON.stringify(r)))).toEqual(hashes);
    const changed={...r,config:{...r.config,maxOutputTokens:128}};expect(reportCommitments(changed).configurationCommitment).not.toBe(hashes.configurationCommitment);
    const changedResult=structuredClone(r);changedResult.requests[0].outputTokens=8;changedResult.requests[0].throughputTokensPerSecond=8/0.3;changedResult.statistics=statistics(changedResult.requests);expect(reportCommitments(changedResult).resultCommitment).not.toBe(hashes.resultCommitment);
    const changedTime=structuredClone(r);changedTime.startedAt='2026-11-11T12:01:00.000Z';expect(reportCommitments(changedTime).reportCommitment).not.toBe(hashes.reportCommitment);
  });
  it('rejects tampered aggregates and contradictory gateway/GPU claims',async()=>{
    const r=await report();r.statistics.successful=99;expect(()=>validateReport(r)).toThrow('aggregates');
    const other=await report();other.requests[0].verification={status:'gateway',modelTeeVerified:true,gpuTeeVerified:true,reason:'verified'};expect(()=>validateReport(other)).toThrow('Contradictory');
  });
  it('rejects extra provider secrets and modified fixed prompts',async()=>{
    const r=await report();expect(()=>validateReport({...r,apiKey:'secret'})).toThrow();const changed={...r,config:{...r.config,prompts:['secret prompt',...r.config.prompts.slice(1)]}};expect(()=>validateReport(changed)).toThrow('snapshot');
  });
  it('refuses test-fixture publication and constructs only commitment-bearing live receipt payloads',async()=>{
    const r=await report();expect(()=>constructBenchmarkReceipt(r)).toThrow('Test fixtures');
    // Only a schema unit test: changing this marker does not create a live observation.
    const receipt=constructBenchmarkReceipt({...r,origin:'live'});
    expect(receipt.network).toBe('testnet');expect(receipt.reportCommitment).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt).not.toHaveProperty('transactionHash');expect(receipt).not.toHaveProperty('prompts');expect(receipt).not.toHaveProperty('model');
    expect(benchmarkReceiptSchema.safeParse({...receipt,apiKey:'secret'}).success).toBe(false);
  });
});
describe('Phase A API security boundary — no live provider calls',()=>{
  it('returns an honest unavailable response for valid input',async()=>{
    const response=await POST(req(config));expect(response.status).toBe(503);expect(await response.text()).toContain('No inference requests');expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it.each([{prompt:'SECRET'},{apiKey:'SECRET'},{baseUrl:'https://evil.test'},{verification:{status:'provider_tee'}},{concurrency:20}])('rejects extra data or excess budget %j',async extra=>{
    const response=await POST(req({...config,...extra}));expect(response.status).toBe(400);expect(await response.text()).not.toContain('SECRET');
  });
  it('rejects cross-origin and missing-origin requests',async()=>{expect((await POST(req(config,{origin:'https://evil.test'}))).status).toBe(403);const request=req(config);request.headers.delete('origin');expect((await POST(request)).status).toBe(403);});
  it('rejects public hosts even when their origin matches',async()=>{expect((await POST(new Request('https://public.test/api/benchmarks',{method:'POST',headers:{host:'public.test',origin:'https://public.test','content-type':'application/json'},body:JSON.stringify(config)}))).status).toBe(403);});
  it('bounds payloads and rejects malformed JSON/content types',async()=>{
    expect((await POST(req({data:'x'.repeat(2049)}))).status).toBe(413);expect((await POST(req(config,{'content-type':'text/plain'}))).status).toBe(415);
    expect((await POST(new Request('http://localhost:3000/api/benchmarks',{method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json'},body:'{'}))).status).toBe(400);
  });
  it('times out stalled request bodies without sending a provider request',async()=>{
    vi.useFakeTimers();
    try {
      const request=new Request('http://localhost:3000/api/benchmarks',{method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json'},body:new ReadableStream(),duplex:'half'} as RequestInit & {duplex:string});
      const pending=POST(request);await vi.advanceTimersByTimeAsync(5001);expect((await pending).status).toBe(408);
    } finally {vi.useRealTimers();}
  });
  it('retires the paid financial explanation endpoint',async()=>{const response=await retired();expect(response.status).toBe(410);});
});
