import { readFileSync } from 'node:fs';
import { describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { compareProofEvidence } from '../../src/lib/server/proof-compare';
import { statistics } from '../../src/lib/compute/metrics';
const original=JSON.parse(readFileSync('evidence/groq-report.json','utf8'));
describe('offline evidence comparison',()=>{
 it('reproduces the historical digest without mutation and ignores key order',()=>{
  const before=JSON.stringify(original);
  expect(compareProofEvidence(original,Object.fromEntries(Object.entries(original).reverse()))).toEqual({sameCommitment:true,beforeCommitment:'7ba15a1cb551de64840d2748fd73f13c0ad8b32dce424429d404877dedc9545c',afterCommitment:'7ba15a1cb551de64840d2748fd73f13c0ad8b32dce424429d404877dedc9545c',changedPaths:[]});
  expect(JSON.stringify(original)).toBe(before);
 });
 it('identifies a changed model without disclosing values',()=>{
  const changed=structuredClone(original);changed.config.model='private-model-name';
  const result=compareProofEvidence(original,changed);
  expect(result.sameCommitment).toBe(false);expect(result.changedPaths).toEqual(['/config/model']);
  expect(JSON.stringify(result)).not.toContain('private-model-name');
 });
 it('identifies timing and reconciled aggregates',()=>{
  const changed=structuredClone(original);changed.requests[0].latencyMs+=10;
  changed.requests[0].throughputTokensPerSecond=changed.requests[0].outputTokens/(changed.requests[0].latencyMs/1000);
  changed.statistics=statistics(changed.requests);
  const result=compareProofEvidence(original,changed);
  expect(result.sameCommitment).toBe(false);expect(result.changedPaths).toContain('/requests/0/latencyMs');
  expect(result.changedPaths).toContain('/statistics/latencyMs/p50');
 });
 it('preserves v1 compatibility',()=>{
  const v1=JSON.parse(readFileSync('public/examples/benchmark.json','utf8'));
  expect(compareProofEvidence(v1,v1)).toMatchObject({sameCommitment:true,changedPaths:[]});
 });
 it('rejects invalid evidence instead of comparing unchecked inputs',()=>{
  expect(()=>compareProofEvidence(original,{})).toThrow();
  const changed=structuredClone(original);changed.statistics.successful=999;
  expect(()=>compareProofEvidence(original,changed)).toThrow();
 });
});
