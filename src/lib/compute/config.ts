import { z } from 'zod';
import type { CloudProviderId } from './providers';

export const workload = Object.freeze({
  id:'short-answer-v1' as const,
  system:'Answer the request directly in plain text. Do not use tools. Keep the answer under 50 words.',
  prompts:Object.freeze([
    'Explain in two sentences why measuring network latency differs from measuring GPU execution time.',
    'List three reasons repeated inference requests can have different latencies. Use one short sentence.',
    'Explain in two sentences what a cryptographic commitment does and does not prove.',
  ]),
});
export const configSchema=z.object({
  model:z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
  workload:z.literal(workload.id).default(workload.id),
  warmupRequests:z.number().int().min(0).max(2).default(1),
  measuredRequests:z.number().int().min(1).max(8).default(5),
  concurrency:z.number().int().min(1).max(2).default(1),
  maxOutputTokens:z.number().int().min(16).max(256).default(96),
  requestTimeoutMs:z.number().int().min(1000).max(60000).default(30000),
}).strict().refine(c=>c.warmupRequests+c.measuredRequests<=10,'At most ten inference attempts per run');
export type BenchmarkConfig=z.infer<typeof configSchema>;
export const RUN_TIMEOUT_MS=120000;
export const VERIFICATION_TIMEOUT_MS=10000;
export function configurationSnapshot(config:BenchmarkConfig,provider?:CloudProviderId) {
  return {...configSchema.parse(config),...(provider?{provider}:{}),system:workload.system,prompts:[...workload.prompts],temperature:0,topP:1,stream:true,choices:1,runTimeoutMs:RUN_TIMEOUT_MS,verificationTimeoutMs:VERIFICATION_TIMEOUT_MS} as const;
}
export function requestBody(config:BenchmarkConfig,index:number) {
  if(!Number.isSafeInteger(index)||index<0)throw new Error('Invalid request index');
  return {model:config.model,messages:[{role:'system' as const,content:workload.system},{role:'user' as const,content:workload.prompts[index%workload.prompts.length]}],max_tokens:config.maxOutputTokens,temperature:0,top_p:1,n:1,stream:true as const,stream_options:{include_usage:true}};
}
