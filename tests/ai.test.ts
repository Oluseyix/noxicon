import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCsv } from '../src/lib/finance';
import { createEvidence } from '../src/lib/challenges';
import { explanationMessages, explanationRequest, explanationRequestSchema } from '../src/lib/ai-contract';
vi.mock('server-only',()=>({}));
import { assertLocalRequest, readSmallJson } from '../src/lib/server/ai-http';
import { configuration } from '../src/lib/server/near-ai';
import { POST } from '../src/legacy/api/ai-explain';
import { verifyGatewayAttestation } from '@nearai/inference-sdk/node';
const rows=parseCsv(readFileSync('public/samples/financial-records.csv','utf8'));
const request=(body:unknown)=>new Request('http://localhost:3000/api/ai/explain',{method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(body)});
afterEach(()=>vi.unstubAllEnvs());
describe('AI privacy contract',()=>{
  it.each(['all','classified','breakdown'] as const)('projects only the approved %s disclosure',async kind=>{
    const evidence=await createEvidence(rows,kind,'a'.repeat(64));
    const payload=explanationRequest(evidence,'catalog/model');
    const text=JSON.stringify(explanationMessages(payload));
    expect(payload.aggregate.result).toEqual(evidence.result);
    for(const privateField of ['transaction_id','customer_id','sender','recipient','commitments','wallet-a','cust-a','a'.repeat(64)])expect(text).not.toContain(privateField);
    expect(text).toContain('NOT TEE-attested');
  });
  it('rejects raw rows, extra fields and missing explicit consent',async()=>{
    const payload=explanationRequest(await createEvidence(rows,'all','a'.repeat(64)),'catalog/model');
    expect(explanationRequestSchema.safeParse({...payload,records:rows}).success).toBe(false);
    expect(explanationRequestSchema.safeParse({...payload,consent:false}).success).toBe(false);
    expect(explanationRequestSchema.safeParse({...payload,aggregate:{...payload.aggregate,result:{...payload.aggregate.result,sender:'secret'}}}).success).toBe(false);
    expect(explanationRequestSchema.safeParse({...payload,aggregate:{...payload.aggregate,result:{...payload.aggregate.result,share:'99.00%'}}}).success).toBe(false);
  });
  it('rejects cross-origin and nonlocal requests',()=>{
    expect(()=>assertLocalRequest(request({}))).not.toThrow();
    expect(()=>assertLocalRequest(new Request('http://localhost:3000/api/ai/explain',{headers:{host:'localhost:3000',origin:'https://evil.example'}}))).toThrow('originate');
    expect(()=>assertLocalRequest(new Request('https://public.example/api/ai/explain',{headers:{host:'public.example',origin:'https://public.example'}}))).toThrow('local demo');
  });
  it('rejects oversized and malformed bodies before calling AI',async()=>{
    await expect(readSmallJson(request({data:'x'.repeat(4097)}))).rejects.toThrow('4 KB');
    const response=await POST(request({records:rows}));expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('cust-a');
  });
  it('reports missing credentials without making a provider call',()=>{
    vi.stubEnv('NEAR_AI_API_KEY','');expect(configuration).toThrow('not configured');
  });
  it('the real official verifier rejects fabricated hardware evidence',async()=>{
    await expect(verifyGatewayAttestation({attestation:{nonce:'00'.repeat(32),signer:{signingAlgo:'ed25519',signingAddress:'00'.repeat(32)},intelQuote:'not-a-real-quote',reportedQuoteData:'00'.repeat(64),eventLog:[],appCompose:'{}'},clientBinding:{nonce:'00'.repeat(32)}})).rejects.toThrow();
  });
});
