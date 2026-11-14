import { z } from 'zod';
export const verificationSchema=z.object({
  status:z.enum(['provider_tee','gateway','failed','unavailable','not_requested']),
  modelTeeVerified:z.boolean(),gpuTeeVerified:z.boolean(),
  reason:z.enum(['verified','verification_failed','missing_model_evidence','evidence_unavailable','not_requested']),
}).strict();
export type Verification=z.infer<typeof verificationSchema>;
// Internal adapter observations, never user-submitted evidence. This maps SDK outcomes;
// it does not verify hardware, signatures, or the truth of an observation itself.
const observationSchema=z.discriminatedUnion('status',[
  z.object({status:z.literal('verified'),signatureKind:z.enum(['provider_tee','gateway']),modelAttestationVerified:z.boolean(),gpuEvidenceVerified:z.boolean()}).strict(),
  z.object({status:z.literal('failed')}).strict(),
  z.object({status:z.literal('unavailable')}).strict(),
]);
export type VerificationObservation=z.infer<typeof observationSchema>;
export function mapVerification(observation?:VerificationObservation):Verification {
  const base={modelTeeVerified:false,gpuTeeVerified:false};
  if(observation===undefined)return {...base,status:'not_requested',reason:'not_requested'};
  if(!observationSchema.safeParse(observation).success)return {...base,status:'failed',reason:'verification_failed'};
  if(observation.status==='failed')return {...base,status:'failed',reason:'verification_failed'};
  if(observation.status==='unavailable')return {...base,status:'unavailable',reason:'evidence_unavailable'};
  if(observation.signatureKind==='gateway')return {...base,status:'gateway',reason:'verified'};
  if(!observation.modelAttestationVerified)return {...base,status:'failed',reason:'missing_model_evidence'};
  return {status:'provider_tee',reason:'verified',modelTeeVerified:true,gpuTeeVerified:observation.gpuEvidenceVerified};
}
