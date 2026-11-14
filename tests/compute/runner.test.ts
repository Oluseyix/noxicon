import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { runBenchmark } from '../../src/lib/server/compute-runner';
import { validateReport } from '../../src/lib/server/compute-report';
import { chunk, config, fixture } from './helpers';
import type { Progress } from '../../src/lib/compute/types';
afterEach(()=>vi.useRealTimers());
describe('server-side benchmark runner using explicit test transports',()=>{
  it('records monotonic stream metrics and excludes warm-ups from measured statistics',async()=>{
    const f=fixture(),events:Progress[]=[];
    const report=await runBenchmark({...config,warmupRequests:1,measuredRequests:3},f.transport,{...f.options,onProgress:e=>events.push(e)});
    expect(report.requests).toHaveLength(4);expect(report.requests[0].phase).toBe('warmup');
    expect(report.requests[1]).toMatchObject({status:'success',latencyMs:300,ttftMs:100,outputTokens:4,tokenSource:'reported',verification:{status:'unavailable'}});
    expect(report.statistics).toMatchObject({planned:3,successful:3,latencyMs:{samples:3,p50:300,p95:300},ttftMs:{p50:100}});
    expect(report.statistics.throughput.reported.mean).toBeCloseTo(4/0.3);
    expect(report.durationMs).toBe(1200);expect(events.at(-1)?.stage).toBe('finished');expect(validateReport(report)).toEqual(report);
  });
  it('keeps token estimates separate and does not expose generated text',async()=>{
    const f=fixture();f.transport.open=async()=> (async function*(){yield chunk('private-output-value');yield chunk(null,'stop');})();
    const r=await runBenchmark(config,f.transport,f.options);expect(r.requests[0].tokenSource).toBe('estimated');expect(r.statistics.throughput.reported.samples).toBe(0);expect(JSON.stringify(r)).not.toContain('private-output-value');
  });
  it('records failure without returning sensitive upstream error text',async()=>{
    const f=fixture();f.transport.open=async()=>{throw new Error('Bearer SECRET_KEY upstream body');};const r=await runBenchmark({...config,measuredRequests:2},f.transport,f.options);
    expect(r.statistics).toMatchObject({failed:2,successful:0,latencyMs:{p50:null,p95:null}});expect(JSON.stringify(r)).not.toContain('SECRET_KEY');expect(validateReport(r)).toEqual(r);
  });
  it('rejects streams ending without a finish reason',async()=>{const f=fixture();f.transport.open=async()=> (async function*(){yield chunk('partial');})();const r=await runBenchmark(config,f.transport,f.options);expect(r.requests[0]).toMatchObject({status:'failed',errorCode:'invalid_stream',throughputTokensPerSecond:null});});
  it('separates inference timing from verification timing and failure',async()=>{
    let clock=0;const f=fixture();f.transport.open=async()=> (async function*(){clock=10;yield chunk('answer');clock=20;yield chunk(null,'stop');})();
    f.transport.verify=async()=>{clock+=1000;throw new Error('bad quote with secret');};
    const r=await runBenchmark(config,f.transport,{...f.options,now:()=>clock});expect(r.requests[0]).toMatchObject({status:'success',latencyMs:20,ttftMs:10,verificationMs:1000,verification:{status:'failed'}});expect(r.verification.failed).toBe(1);
  });
  it('does not turn gateway verification into model TEE evidence',async()=>{const f=fixture();f.transport.verify=async()=>({status:'verified',signatureKind:'gateway',modelAttestationVerified:false,gpuEvidenceVerified:false});const r=await runBenchmark(config,f.transport,f.options);expect(r.verification).toMatchObject({gateway:1,providerTee:0,gpuTee:0});});
  it('enforces capabilities before dispatch',async()=>{const f=fixture();f.transport.capabilities.streaming=false;await expect(runBenchmark(config,f.transport)).rejects.toThrow('confirmed');});
  it('skips every request when cancelled before execution',async()=>{const f=fixture(),c=new AbortController();c.abort();const open=vi.spyOn(f.transport,'open');const r=await runBenchmark(config,f.transport,{...f.options,signal:c.signal});expect(open).not.toHaveBeenCalled();expect(r.status).toBe('cancelled');expect(r.requests[0].status).toBe('skipped');});
  it('times out a request, stops further scheduling, and sanitizes the outcome',async()=>{
    vi.useFakeTimers();const f=fixture();f.transport.open=(_,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true}));
    const pending=runBenchmark({...config,measuredRequests:3,requestTimeoutMs:1000},f.transport,f.options);await vi.advanceTimersByTimeAsync(1001);const r=await pending;
    expect(r.requests.map(r=>r.status)).toEqual(['timed_out','skipped','skipped']);expect(r.status).toBe('transport_stalled');expect(r.statistics.timedOut).toBe(1);
  });
  it('cancels an active request and skips later attempts',async()=>{
    const f=fixture(),c=new AbortController();f.transport.open=(_,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true}));
    const pending=runBenchmark({...config,measuredRequests:2},f.transport,{...f.options,signal:c.signal});c.abort();const r=await pending;expect(r.requests.map(r=>r.status)).toEqual(['cancelled','skipped']);
  });
  it('bounds concurrency and rejects overlapping runs',async()=>{
    vi.useFakeTimers();const f=fixture();let active=0,maximum=0,calls=0;
    f.transport.open=async()=>{calls++;active++;maximum=Math.max(active,maximum);return (async function*(){await new Promise(resolve=>setTimeout(resolve,100));yield chunk('ok');yield chunk(null,'stop');active--;})();};
    const pending=runBenchmark({...config,measuredRequests:5,concurrency:2},f.transport,f.options);
    await expect(runBenchmark(config,f.transport,f.options)).rejects.toThrow('already running');
    await vi.runAllTimersAsync();const r=await pending;expect(maximum).toBe(2);expect(calls).toBe(5);expect(r.statistics.successful).toBe(5);
  });
  it('bounds response verification separately and withholds verification claims on timeout',async()=>{
    vi.useFakeTimers();const f=fixture();f.transport.verify=(_,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true}));
    const pending=runBenchmark({...config,measuredRequests:2},f.transport,f.options);await vi.advanceTimersByTimeAsync(10001);const r=await pending;
    expect(r.requests[0]).toMatchObject({status:'success',verification:{status:'unavailable',gpuTeeVerified:false}});expect(r.requests[1].status).toBe('skipped');
  });
  it('starts request timing after progress notification, immediately before dispatch',async()=>{
    let clock=0;const f=fixture();
    f.transport.open=async()=> (async function*(){clock+=10;yield chunk('ok');clock+=10;yield chunk(null,'stop');})();
    const r=await runBenchmark(config,f.transport,{...f.options,now:()=>clock,onProgress:e=>{if(e.status===null&&e.stage==='measured')clock+=500;}});
    expect(r.requests[0]).toMatchObject({latencyMs:20,ttftMs:10});
  });
  it('does not let progress callbacks break a run',async()=>{const f=fixture();const r=await runBenchmark(config,f.transport,{...f.options,onProgress:()=>{throw new Error('observer');}});expect(r.statistics.successful).toBe(1);});
  it('keeps the process gate closed while a timed-out transport ignores abort',async()=>{
    vi.useFakeTimers();const f=fixture();let release!:(value:AsyncIterable<unknown>)=>void;
    f.transport.open=()=>new Promise(resolve=>{release=resolve;});
    const pending=runBenchmark({...config,requestTimeoutMs:1000},f.transport,f.options);await vi.advanceTimersByTimeAsync(1001);expect((await pending).requests[0].status).toBe('timed_out');
    await expect(runBenchmark(config,fixture().transport)).rejects.toThrow('already running');
    release((async function*(){yield chunk('late');})());await vi.advanceTimersByTimeAsync(0);
    const fresh=fixture();expect((await runBenchmark(config,fresh.transport,fresh.options)).statistics.successful).toBe(1);
  });
  it('enforces the overall run deadline even across individually valid requests',async()=>{
    vi.useFakeTimers();const f=fixture();
    f.transport.open=async(_,signal)=> (async function*(){await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,50000);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('abort'));},{once:true});});yield chunk('ok');yield chunk(null,'stop');})();
    const pending=runBenchmark({...config,measuredRequests:4,requestTimeoutMs:60000},f.transport,f.options);await vi.advanceTimersByTimeAsync(120001);const r=await pending;
    expect(r.status).toBe('deadline_exceeded');expect(r.requests.map(r=>r.status)).toEqual(['success','success','timed_out','skipped']);
  });
});
