import { z } from 'zod';
import type { CloudProviderId } from './providers';
import type { configurationSnapshot, requestBody } from './config';
import { providerErrorCodes } from './provider-errors';
import { verificationSchema, type VerificationObservation } from './verification';
const ms=z.number().finite().nonnegative();
export const requestResultSchema=z.object({
  index:z.number().int().nonnegative(),phase:z.enum(['warmup','measured']),promptIndex:z.number().int().min(0).max(2),
  status:z.enum(['success','failed','timed_out','cancelled','skipped']),
  latencyMs:ms.nullable(),ttftMs:ms.nullable(),verificationMs:ms.nullable(),
  completionId:z.string().max(200).nullable(),finishReason:z.enum(['stop','length']).nullable(),
  outputTokens:z.number().int().nonnegative().nullable(),tokenSource:z.enum(['reported','estimated','unavailable']),
  tokenScope:z.enum(['provider_completion_including_reasoning','visible_text_utf8_bytes_div_4','unavailable']),
  throughputTokensPerSecond:ms.nullable(),outputBytes:z.number().int().nonnegative(),
  errorCode:z.enum(['request_failed','invalid_stream','empty_output','timeout','cancelled','not_started',...providerErrorCodes]).nullable(),
  verification:verificationSchema,
}).strict();
export type RequestResult=z.infer<typeof requestResultSchema>;
export type Distribution={samples:number;p50:number|null;p95:number|null;mean:number|null};
export type Statistics={planned:number;attempted:number;successful:number;failed:number;timedOut:number;cancelled:number;skipped:number;latencyMs:Distribution;ttftMs:Distribution;throughput:{definition:'completion_tokens_per_total_request_second';reported:Distribution;estimated:Distribution}};
export type VerificationSummary={providerTee:number;gpuTee:number;gateway:number;failed:number;unavailable:number;notRequested:number};
export type BenchmarkReport={
  application:'veyra-compute';schemaVersion:1|2;runId:string;origin:'live'|'test-fixture';
  startedAt:string;completedAt:string;durationMs:number;
  status:'completed'|'cancelled'|'deadline_exceeded'|'transport_stalled'|'provider_error';
  config:ReturnType<typeof configurationSnapshot>;
  requests:RequestResult[];statistics:Statistics;verification:VerificationSummary;
};
export type Progress={stage:'warmup'|'measured'|'verifying'|'finished';index:number;completed:number;total:number;status:RequestResult['status']|null};
export type BenchmarkTransport={
  provider?:CloudProviderId;
  origin:'live'|'test-fixture';
  capabilities:{model:string;streaming:boolean;maxOutputTokens:number};
  open(body:ReturnType<typeof requestBody>,signal:AbortSignal):Promise<AsyncIterable<unknown>>;
  verify?(completionId:string,signal:AbortSignal):Promise<VerificationObservation>;
};
