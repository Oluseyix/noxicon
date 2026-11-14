import { z } from 'zod';
import { definitions, percentage } from './finance';
import type { Evidence } from './challenges';

const cents = z.string().regex(/^(0|[1-9]\d{0,24})$/);
const common = { currency:z.literal('USD'), period:z.literal('2026-10') };
const ratio = z.object({...common, returningCents:cents, denominatorCents:cents, share:z.string().regex(/^\d+\.\d{2}%$/).nullable()}).strict()
  .refine(r=>BigInt(r.returningCents)<=BigInt(r.denominatorCents) && r.share===percentage(BigInt(r.returningCents),BigInt(r.denominatorCents)), 'Inconsistent engine ratio');
const breakdown = z.object({...common, customerPaymentsCents:cents, internalCents:cents, unclassifiedCents:cents, totalCents:cents}).strict()
  .refine(r=>BigInt(r.totalCents)===BigInt(r.customerPaymentsCents)+BigInt(r.internalCents)+BigInt(r.unclassifiedCents),'Inconsistent engine breakdown');
export const approvedAggregateSchema = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('all'),result:ratio}).strict(),
  z.object({kind:z.literal('classified'),result:ratio}).strict(),
  z.object({kind:z.literal('breakdown'),result:breakdown}).strict(),
]);
export const explanationRequestSchema = z.object({
  consent:z.literal(true),
  model:z.string().min(1).max(200).regex(/^[a-zA-Z0-9._:/-]+$/),
  aggregate:approvedAggregateSchema,
}).strict();
export type ExplanationRequest = z.infer<typeof explanationRequestSchema>;
// An explicit projection: never spread evidence, rows, filenames, hashes or salt into an API payload.
export function explanationRequest(e:Evidence,model:string):ExplanationRequest {
  return explanationRequestSchema.parse({consent:true,model,aggregate:{kind:e.kind,result:e.result}});
}
export function explanationMessages(input:ExplanationRequest) {
  const safe = explanationRequestSchema.parse(input);
  return [
    {role:'system' as const,content:'Explain the supplied financial-engine aggregates and definition in at most 150 words. Do not calculate new figures or introduce financial results. Do not treat company classifications, identities, record authenticity or completeness as verified. Local arithmetic is NOT TEE-attested. Attestation applies only to this AI inference, not financial truth. No blockchain publication has occurred. Explain the denominator and limitations in plain language.'},
    {role:'user' as const,content:JSON.stringify({definition:definitions[safe.aggregate.kind],result:safe.aggregate.result})},
  ];
}
export type AiExplanation = {
  text:string; model:string; completionId:string; verifiedAt:string;
  verification:{signatureKind:'provider_tee';gatewayTls:'attested';gpuEvidence:'verified';tcbStatuses:string[];signers:string[];deploymentProvenance:'not_checked';scope:'AI inference only; financial calculations are not TEE-attested'};
};
