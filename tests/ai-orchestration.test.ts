import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const fake=vi.hoisted(()=>({verify:vi.fn(),create:vi.fn(),verifyResponse:vi.fn(),clear:vi.fn()}));
// These test doubles exercise withholding behavior; they are NOT live attestation tests.
vi.mock('@nearai/inference-sdk/node',()=>({
  InferenceClient:class {verify=fake.verify;chat={completions:{create:fake.create}};verifyResponse=fake.verifyResponse;clearResponseCache=fake.clear;},
  getSdkError:()=>undefined,isVerificationError:()=>false,
}));
import { explain } from '../src/lib/server/near-ai';
import type { ExplanationRequest } from '../src/lib/ai-contract';
const input:ExplanationRequest={consent:true,model:'test/model',aggregate:{kind:'all',result:{currency:'USD',period:'2026-10',returningCents:'1',denominatorCents:'2',share:'50.00%'}}};
let version:PropertyDescriptor|undefined;
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv('NEAR_AI_API_KEY','test-only-not-a-real-key');
  version=Object.getOwnPropertyDescriptor(process.versions,'node');Object.defineProperty(process.versions,'node',{value:'24.22.1',configurable:true});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({data:[{id:'test/model'}]})));
  fake.verify.mockResolvedValue({gateway:{tlsBinding:{kind:'attested'}},models:[{}]});
  fake.create.mockResolvedValue({id:'test-completion',choices:[{message:{content:'test commentary'},finish_reason:'stop'}]});
  fake.verifyResponse.mockResolvedValue({id:'test-completion',signatureKind:'provider_tee',attestations:[{gpuEvidence:'verified',tcbStatus:'UpToDate',signer:{signingAddress:'test-signer'}}]});
});
afterEach(()=>{if(version)Object.defineProperty(process.versions,'node',version);vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('fail-closed AI orchestration (test doubles)',()=>{
  it('withholds inference when preflight fails',async()=>{fake.verify.mockRejectedValueOnce(new Error('bad quote'));await expect(explain(input)).rejects.toThrow('No AI output');expect(fake.create).not.toHaveBeenCalled();});
  it('withholds output when the response signature fails',async()=>{fake.verifyResponse.mockRejectedValueOnce(new Error('bad signature'));await expect(explain(input)).rejects.toThrow('No AI output');expect(fake.clear).toHaveBeenCalled();});
  it('rejects gateway-only signatures',async()=>{fake.verifyResponse.mockResolvedValueOnce({signatureKind:'gateway'});await expect(explain(input)).rejects.toThrow('No AI output');});
  it('rejects missing GPU evidence',async()=>{fake.verifyResponse.mockResolvedValueOnce({signatureKind:'provider_tee',attestations:[{gpuEvidence:'not_provided'}]});await expect(explain(input)).rejects.toThrow('No AI output');});
  it('returns commentary only after response verification',async()=>{const result=await explain(input);expect(result.text).toBe('test commentary');expect(result.verification.scope).toContain('not TEE-attested');expect(fake.verifyResponse).toHaveBeenCalledWith('test-completion');});
  it('does not use a model missing from the real catalog',async()=>{await expect(explain({...input,model:'unlisted/model'})).rejects.toThrow('no longer');expect(fake.create).not.toHaveBeenCalled();});
});
