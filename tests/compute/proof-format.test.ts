import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { proofCommitment, publicationEvidence, proofMethods } from '../../src/lib/server/proof-format';
import { reportCommitments } from '../../src/lib/server/compute-report';
import { canonicalJson, validateReport } from '../../src/lib/compute/report';
import { statistics, verificationSummary } from '../../src/lib/compute/metrics';
import { mapVerification } from '../../src/lib/compute/verification';
import { liveReport } from './proof-helpers';

describe('versioned publication evidence commitments — synthetic fixtures only',()=>{
 it('has a stable independent test vector for the existing v1 bundled synthetic report',()=>{
  const sample=JSON.parse(readFileSync('public/examples/benchmark.json','utf8'));
  expect(proofCommitment(sample).commitment).toBe('20d1a3a7c2c3afb24b0f642ac26cf4de1921206e14dc961e5300ac39c266eda7');
 });
 it.each([1,2] as const)('preserves schema v%i and existing hash envelopes without mutating the report',version=>{
  const report=liveReport(version),before=JSON.stringify(report),existing=reportCommitments(report);
  const proof=proofCommitment(report);expect(proof.commitment).toMatch(/^[a-f0-9]{64}$/);
  expect(proofCommitment(JSON.parse(before)).commitment).toBe(proof.commitment);expect(JSON.stringify(report)).toBe(before);expect(reportCommitments(report)).toEqual(existing);
  const reordered=Object.fromEntries(Object.entries(report).reverse());expect(proofCommitment(reordered).commitment).toBe(proof.commitment);
 });
 it('accepts historical v2 without inventing a provider and current Groq v2 attribution',()=>{
  const report=liveReport();const legacy=JSON.parse(JSON.stringify(report));delete legacy.config.provider;
  expect(validateReport(legacy).config).not.toHaveProperty('provider');expect(publicationEvidence(report).config.provider).toBe('groq');
  expect(proofCommitment(legacy).commitment).not.toBe(proofCommitment(report).commitment);
 });
 it.each(['timing','model','outcome','provider'])('changes the commitment for modified %s',change=>{
  const original=liveReport(),report=structuredClone(original);
  if(change==='timing'){report.requests[1].latencyMs!+=1;report.durationMs+=1;report.statistics=statistics(report.requests);}
  if(change==='model')report.config={...report.config,model:'different/model'};
  if(change==='provider')report.config={...report.config,provider:'near-ai-cloud'};
  if(change==='outcome')report.requests[1].errorCode='invalid_stream';
  expect(proofCommitment(report).commitment).not.toBe(proofCommitment(original).commitment);
 });
 it('excludes verification observations/results and keeps publication metadata in a separate receipt',()=>{
  const report=liveReport(1),changed=structuredClone(report);
  changed.requests[0].verification=mapVerification({status:'unavailable'});changed.requests[0].verificationMs=5;
  changed.verification=verificationSummary(changed.requests);
  expect(proofCommitment(changed).commitment).toBe(proofCommitment(report).commitment);
  const evidence=publicationEvidence(changed);expect(evidence).not.toHaveProperty('verification');expect(evidence.requests[0]).not.toHaveProperty('verificationMs');
  expect(()=>proofCommitment({...report,transactionHash:'untrusted'})).toThrow();
 });
 it('commits ordered arrays, fractional numbers, Unicode and exact JSON primitives',()=>{
  expect(canonicalJson({z:[2,1],a:'é',n:0.25})).toBe('{"a":"é","n":0.25,"z":[2,1]}');
  expect(canonicalJson({n:-0})).toBe('{"n":0}');expect(()=>canonicalJson({n:Infinity})).toThrow();
  const proof=proofCommitment(liveReport());expect(proofMethods(proof.commitment,proof.runId)).toEqual(['veyra-benchmark-evidence:v1',`sha256:${proof.commitment}`,`run:${proof.runId}`,'network:testnet']);
 });
});
