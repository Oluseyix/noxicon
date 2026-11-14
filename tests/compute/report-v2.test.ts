import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { runBenchmark } from '../../src/lib/server/compute-runner';
import { ProviderError } from '../../src/lib/server/compute-provider-error';
import { validateReport, reportCommitments, constructBenchmarkReceipt, digest } from '../../src/lib/server/compute-report';
import { inspectReport } from '../../src/lib/compute/report-browser';
import { statistics } from '../../src/lib/compute/metrics';
import { config, fixture, chunk } from './helpers';

describe('version 2 live observations, version 1 compatibility',()=>{
 it('imports historical v2 reports without provider metadata and preserves their commitment envelopes',async()=>{
  const f=fixture();f.transport.origin='live';const generated=await runBenchmark(config,f.transport,f.options);
  const legacy=JSON.parse(JSON.stringify(generated));delete legacy.config.provider;
  expect(validateReport(legacy).config).not.toHaveProperty('provider');
  const hashes=reportCommitments(legacy);
  expect(hashes.configurationCommitment).toBe(digest('configuration',legacy.config,2));
  expect(hashes.resultCommitment).toBe(digest('result',{requests:legacy.requests,statistics:legacy.statistics,verification:legacy.verification},2));
  expect(hashes.reportCommitment).toBe(digest('report',legacy,2));
  expect((await inspectReport(JSON.stringify(legacy))).commitments).toEqual(hashes);
 });
 it('records missing provider usage as unavailable and preserves measured timing',async()=>{
  const f=fixture();f.transport.origin='live';let now=0;f.transport.open=async()=> (async function*(){now=10;yield chunk('private generated answer');now=20;yield chunk(null,'stop');})();
  const r=await runBenchmark(config,f.transport,{...f.options,now:()=>now});
  expect(r.schemaVersion).toBe(2);expect(r.requests[0]).toMatchObject({status:'success',ttftMs:10,latencyMs:20,outputTokens:null,tokenSource:'unavailable',tokenScope:'unavailable',throughputTokensPerSecond:null,verificationMs:null,verification:{status:'not_requested'}});
  expect(r.statistics.throughput).toMatchObject({reported:{samples:0,mean:null},estimated:{samples:0,mean:null}});expect(r.verification).toMatchObject({notRequested:1,providerTee:0,gpuTee:0});expect(JSON.stringify(r)).not.toContain('private generated answer');expect(validateReport(r)).toEqual(r);
  expect((await inspectReport(JSON.stringify(r))).commitments).toEqual(reportCommitments(r));
  expect(()=>validateReport({...r,schemaVersion:1})).toThrow('Version 1');
 });
 it('keeps the reported-token formula and original version 1 interpretation intact',async()=>{
  const f=fixture();const old=await runBenchmark(config,f.transport,f.options);expect(old.schemaVersion).toBe(1);const oldHashes=reportCommitments(old);
  expect(oldHashes.reportCommitment).toBe(digest('report',old,1));expect((await inspectReport(JSON.stringify(old))).commitments).toEqual(oldHashes);
  const live=fixture();live.transport.origin='live';const r=await runBenchmark(config,live.transport,live.options);expect(r.requests[0].throughputTokensPerSecond).toBeCloseTo(4/.3);expect(r.schemaVersion).toBe(2);expect((await inspectReport(JSON.stringify(r))).commitments).toEqual(reportCommitments(r));
  expect(reportCommitments({...old,schemaVersion:2}).configurationCommitment).not.toBe(oldHashes.configurationCommitment);
  expect(()=>constructBenchmarkReceipt(r)).toThrow('not enabled');
 });
 it('retains historical v1 estimates but rejects estimates in v2',async()=>{
  const f=fixture();f.transport.open=async()=> (async function*(){yield chunk('old estimate');yield chunk(null,'stop');})();
  const r=await runBenchmark(config,f.transport,f.options);expect(validateReport(r).requests[0].tokenSource).toBe('estimated');expect(()=>validateReport({...r,schemaVersion:2})).toThrow('never estimates');
 });
 it('records safe error codes, halts scheduling and preserves the failed report',async()=>{
  const f=fixture();f.transport.origin='live';const open=vi.fn().mockRejectedValue(new ProviderError('insufficient_credits'));f.transport.open=open;const issue=vi.fn();
  const r=await runBenchmark({...config,measuredRequests:3},f.transport,{...f.options,onIssue:issue});expect(open).toHaveBeenCalledOnce();expect(r.status).toBe('provider_error');expect(r.requests[0].errorCode).toBe('insufficient_credits');expect(r.requests.slice(1).map(r=>r.status)).toEqual(['skipped','skipped']);expect(issue.mock.calls[0][0].message).toContain('credits');expect(validateReport(r)).toEqual(r);expect(()=>validateReport({...r,schemaVersion:1})).toThrow('Version 2');
 });
 it('rejects tampered unavailable usage, aggregates and unsupported report versions',async()=>{
  const f=fixture();f.transport.origin='live';const r=await runBenchmark(config,f.transport,f.options);r.requests[0].tokenSource='unavailable';r.statistics=statistics(r.requests);expect(()=>validateReport(r)).toThrow('token accounting');expect(()=>validateReport({...r,schemaVersion:99})).toThrow();
 });
});
