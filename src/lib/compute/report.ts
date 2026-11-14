import { z } from 'zod';
import { configSchema, configurationSnapshot } from './config';
import { statistics, tokenUsage, verificationSummary } from './metrics';
import { requestResultSchema, type BenchmarkReport } from './types';
import { providerErrorCodes } from './provider-errors';
import { mapVerification } from './verification';
import { cloudProviderSchema } from './providers';

export function canonicalJson(value:unknown):string {
  const active=new Set<object>();
  function encode(v:unknown):string {
    if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
    if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
    if(typeof v!=='object'||v===null)throw new Error('Only finite JSON values can be committed');
    if(active.has(v))throw new Error('Cyclic JSON value');
    active.add(v);
    try {
      if(Array.isArray(v))return `[${Array.from(v,item=>encode(item)).join(',')}]`;
      if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw new Error('Expected a plain JSON object');
      if(Object.getOwnPropertySymbols(v).length)throw new Error('Symbol keys are unsupported');
      return `{${Object.keys(v).sort().map(key=>`${JSON.stringify(key)}:${encode((v as Record<string,unknown>)[key])}`).join(',')}}`;
    }finally{active.delete(v);}
  }
  return encode(value);
}
const count=z.number().int().nonnegative();
const metric=z.number().finite().nonnegative();
const distribution=z.object({samples:count,p50:metric.nullable(),p95:metric.nullable(),mean:metric.nullable()}).strict();
export const reportVerificationSummarySchema=z.object({providerTee:count,gpuTee:count,gateway:count,failed:count,unavailable:count,notRequested:count}).strict();
const reportSchema=z.object({
  application:z.literal('veyra-compute'),schemaVersion:z.union([z.literal(1),z.literal(2)]),runId:z.uuid(),origin:z.enum(['live','test-fixture']),
  startedAt:z.iso.datetime(),completedAt:z.iso.datetime(),durationMs:metric,
  status:z.enum(['completed','cancelled','deadline_exceeded','transport_stalled','provider_error']),
  config:z.record(z.string(),z.unknown()),requests:z.array(requestResultSchema).min(1).max(10),
  statistics:z.object({planned:count,attempted:count,successful:count,failed:count,timedOut:count,cancelled:count,skipped:count,latencyMs:distribution,ttftMs:distribution,
    throughput:z.object({definition:z.literal('completion_tokens_per_total_request_second'),reported:distribution,estimated:distribution}).strict()}).strict(),
  verification:reportVerificationSummarySchema,
}).strict();
function same(a:unknown,b:unknown){return canonicalJson(a)===canonicalJson(b);}
export function validateReport(value:unknown):BenchmarkReport {
  const report=reportSchema.parse(value);
  const {model,workload,warmupRequests,measuredRequests,concurrency,maxOutputTokens,requestTimeoutMs}=report.config;
  if(report.schemaVersion===1&&(report.status==='provider_error'||report.requests.some(r=>providerErrorCodes.includes(r.errorCode as typeof providerErrorCodes[number]))))throw new Error('Version 2 observations require schema version 2');
  const config=configSchema.parse({model,workload,warmupRequests,measuredRequests,concurrency,maxOutputTokens,requestTimeoutMs});
  const provider=report.config.provider===undefined?undefined:cloudProviderSchema.parse(report.config.provider);
  if(provider&&report.schemaVersion!==2)throw new Error('Version 1 reports cannot declare a cloud provider');
  if(!same(report.config,configurationSnapshot(config,provider)))throw new Error('Configuration snapshot differs from the supported workload');
  if(report.requests.length!==config.warmupRequests+config.measuredRequests)throw new Error('Request budget does not match report');
  for(const [index,result] of report.requests.entries()){
    if(result.index!==index||result.phase!==(index<config.warmupRequests?'warmup':'measured')||result.promptIndex!==index%3)throw new Error('Request ordering or phase mismatch');
    if(result.status==='skipped'){
      if(result.latencyMs!==null||result.ttftMs!==null||result.completionId!==null||result.outputBytes!==0||result.finishReason!==null||result.verificationMs!==null||result.errorCode!=='not_started')throw new Error('Skipped request has invented observations');
    }else if(result.latencyMs===null)throw new Error('Attempted request is missing latency');
    if(result.ttftMs!==null&&(result.latencyMs===null||result.ttftMs>result.latencyMs))throw new Error('First content occurs after request completion');
    if(result.status==='success'){
      if(result.outputBytes===0||result.ttftMs===null||!result.completionId||!result.finishReason||result.errorCode!==null)throw new Error('Incomplete successful request');
      if(report.schemaVersion===1&&(result.tokenSource==='unavailable'||result.outputTokens===null))throw new Error('Version 1 success requires token accounting');
      if(report.schemaVersion===2&&result.tokenSource==='estimated')throw new Error('Version 2 never estimates missing usage');
      if(result.tokenSource==='reported'&&result.outputTokens===null)throw new Error('Missing reported token count');
      const usage=tokenUsage(result.tokenSource==='reported'?result.outputTokens:null,result.outputBytes,result.latencyMs!,report.schemaVersion===1);
      if(!same(usage,{outputTokens:result.outputTokens,tokenSource:result.tokenSource,tokenScope:result.tokenScope,throughputTokensPerSecond:result.throughputTokensPerSecond}))throw new Error('Invalid token accounting');
    }else if(result.outputTokens!==null||result.tokenSource!=='unavailable'||result.tokenScope!=='unavailable'||result.throughputTokensPerSecond!==null||result.errorCode===null||result.verification.status!=='not_requested')throw new Error('Failed request contains successful output metrics');
    if((result.status==='timed_out'&&result.errorCode!=='timeout')||(result.status==='cancelled'&&result.errorCode!=='cancelled'))throw new Error('Failure status does not match error code');
    if(provider&&(result.verification.status!=='not_requested'||result.verificationMs!==null))throw new Error('Attributed inference reports cannot claim attestation checks');
    const v=result.verification;
    const expected=v.status==='provider_tee'?mapVerification({status:'verified',signatureKind:'provider_tee',modelAttestationVerified:true,gpuEvidenceVerified:v.gpuTeeVerified})
      :v.status==='gateway'?mapVerification({status:'verified',signatureKind:'gateway',modelAttestationVerified:false,gpuEvidenceVerified:false})
      :v.status==='failed'&&v.reason==='missing_model_evidence'?mapVerification({status:'verified',signatureKind:'provider_tee',modelAttestationVerified:false,gpuEvidenceVerified:false})
      :mapVerification(v.status==='not_requested'?undefined:{status:v.status as 'failed'|'unavailable'});
    if(!same(v,expected))throw new Error('Contradictory verification status');
  }
  if(report.status==='completed'&&report.requests.some(r=>r.status==='skipped'))throw new Error('Completed run contains unstarted requests');
  if(!same(report.statistics,statistics(report.requests))||!same(report.verification,verificationSummary(report.requests)))throw new Error('Report aggregates do not match request observations');
  return report as BenchmarkReport;
}
