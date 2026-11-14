import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { proofCommitment } from '../../src/lib/server/proof-format';
import { verifyProof } from '../../src/lib/server/proof-near';
import { statistics } from '../../src/lib/compute/metrics';
import { validateReport } from '../../src/lib/compute/report';

const report=JSON.parse(readFileSync('evidence/groq-report.json','utf8'));
const receipt=JSON.parse(readFileSync('evidence/near-testnet-receipt.json','utf8'));
describe('unaltered published Groq evidence (no live RPC in automated tests)',()=>{
 it('validates and reproduces the published commitment',()=>{
  expect(validateReport(report)).toMatchObject({schemaVersion:2,origin:'live',config:{provider:'groq',model:'qwen/qwen3.8-27b'}});
  expect(proofCommitment(report).commitment).toBe('7ba15a1cb551de64840d2748fd73f13c0ad8b32dce424429d404877dedc9545c');
  expect(receipt).toMatchObject({commitment:proofCommitment(report).commitment,publisher:'veyra-proof.testnet',network:'testnet',transactionHash:'CHzwHrtoUYfPMj1uHrqNeNCBv2fLVht1mT3gQunQYurQ'});
 });
 it.each(['model','timing'])('rejects internally consistent modified %s evidence before querying RPC',async field=>{
  const changed=structuredClone(report),call=vi.fn().mockRejectedValue(new Error('Must not query'));
  if(field==='model')changed.config.model='modified/model';
  else{
   changed.requests[0].latencyMs+=10;
   changed.requests[0].throughputTokensPerSecond=changed.requests[0].outputTokens/(changed.requests[0].latencyMs/1000);
   changed.statistics=statistics(changed.requests);
  }
  expect(validateReport(changed)).toBeDefined();
  expect(await verifyProof(changed,receipt,'veyra-proof.testnet',{call})).toMatchObject({verified:false,status:'mismatch',code:'report_mismatch'});
  expect(call).not.toHaveBeenCalled();
 });
});
