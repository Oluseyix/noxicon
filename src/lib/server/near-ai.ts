import 'server-only';
import { InferenceClient, getSdkError, isVerificationError } from '@nearai/inference-sdk/node';
import { z } from 'zod';
import { explanationMessages, type ExplanationRequest, type AiExplanation } from '../ai-contract';

const baseUrl='https://cloud-api.near.ai/v1';
export class AiError extends Error {
  constructor(public code:string,message:string,public status=502){super(message);}
}
export function configuration() {
  if(!process.env.NEAR_AI_API_KEY?.trim()) throw new AiError('NOT_CONFIGURED','NEAR AI is not configured. Set NEAR_AI_API_KEY in the server environment.',503);
  const [major,minor,patch]=process.versions.node.split('.').map(Number);
  if(major<24 || (major===24 && (minor<22 || (minor===22 && patch<1)))) throw new AiError('UNSUPPORTED_RUNTIME','NEAR AI verification requires Node.js 24.22.1 or newer.',503);
  return process.env.NEAR_AI_API_KEY;
}
export async function availableModels():Promise<string[]> {
  const apiKey=configuration();
  try {
    const response=await fetch(`${baseUrl}/models`,{headers:{Authorization:`Bearer ${apiKey}`},cache:'no-store',signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok) throw new AiError('CATALOG_FAILED',`NEAR AI model catalog returned HTTP ${response.status}. Check the server credential and service availability.`);
    const parsed=z.object({data:z.array(z.object({id:z.string().min(1).max(200)}))}).parse(await response.json());
    const models=[...new Set(parsed.data.map(m=>m.id))].sort();
    if(!models.length)throw new AiError('NO_MODELS','NEAR AI returned no available models.');
    return models;
  } catch(e) {
    if(e instanceof AiError)throw e;
    throw new AiError('CATALOG_UNAVAILABLE','Could not retrieve the live NEAR AI model catalog. Check connectivity and try again.');
  }
}
export async function explain(input:ExplanationRequest):Promise<AiExplanation> {
  const apiKey=configuration();
  if(!(await availableModels()).includes(input.model)) throw new AiError('MODEL_UNAVAILABLE','This model is no longer in the live NEAR AI catalog. Reload models.',400);
  // Each operation owns a new client: fresh reports, attested TLS and E2EE.
  // Preflight and Chat share these verified reports for at most two minutes.
  // Never install permissive quote/GPU callbacks or fall back to Gateway-only inference.
  const client=new InferenceClient({apiKey,baseUrl,e2ee:true,attestationCacheTimeToLiveMs:120000,
    gatewayVerification:{policy:{acceptedTcbStatuses:['UpToDate']}},
    modelVerification:{policy:{acceptedTcbStatuses:['UpToDate'],gpuEvidence:'required'}},
    responseCacheTimeToLiveMs:120000,
  });
  const signal=AbortSignal.timeout(90000);
  try {
    const deployment=await client.verify(input.model);
    if(signal.aborted)throw new AiError('VERIFICATION_TIMEOUT','Attestation verification timed out. No AI output was released.');
    if(deployment.gateway.tlsBinding.kind!=='attested'||!deployment.models.length)throw new AiError('VERIFICATION_FAILED','Gateway TLS or model attestation is missing. No AI output was released.');
    const completion=await client.chat.completions.create({model:input.model,messages:explanationMessages(input),stream:false,max_tokens:400},{signal});
    const verified=await client.verifyResponse(completion.id);
    if(signal.aborted)throw new AiError('VERIFICATION_TIMEOUT','NEAR AI verification timed out. No AI output was released.');
    if(verified.signatureKind!=='provider_tee'||!verified.attestations.length||verified.attestations.some(a=>a.gpuEvidence!=='verified')) throw new AiError('VERIFICATION_FAILED','Model attestation and response signature verification did not meet the required policy. No AI output was released.');
    const text=completion.choices[0]?.message.content;
    if(!text?.trim()||completion.choices[0]?.finish_reason!=='stop')throw new AiError('INCOMPLETE_RESPONSE','NEAR AI returned an empty or incomplete explanation. No AI output was released.');
    return {text,model:input.model,completionId:verified.id,verifiedAt:new Date().toISOString(),verification:{
      signatureKind:verified.signatureKind,gatewayTls:deployment.gateway.tlsBinding.kind,gpuEvidence:'verified',
      tcbStatuses:verified.attestations.map(a=>a.tcbStatus),signers:verified.attestations.map(a=>a.signer.signingAddress),
      deploymentProvenance:'not_checked',scope:'AI inference only; financial calculations are not TEE-attested',
    }};
  } catch(e) {
    if(e instanceof AiError)throw e;
    const sdkError=getSdkError(e);
    if(sdkError&&isVerificationError(sdkError))throw new AiError('VERIFICATION_FAILED',`NEAR AI verification failed (${sdkError.failure.code}). No AI output was released.`);
    throw new AiError('INFERENCE_FAILED','NEAR AI inference or verification could not complete. Check model attestation support, credentials, quota and connectivity. No AI output was released.');
  } finally {client.clearResponseCache();}
}
