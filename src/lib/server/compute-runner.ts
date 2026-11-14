import 'server-only';
import { ProviderError } from './compute-provider-error';
import { providerNames } from '../compute/providers';
import type { ProviderErrorCode } from '../compute/provider-errors';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { configSchema, configurationSnapshot, requestBody, RUN_TIMEOUT_MS, VERIFICATION_TIMEOUT_MS, workload } from '../compute/config';
import { statistics, tokenUsage, verificationSummary } from '../compute/metrics';
import { StreamCollector, StreamError } from '../compute/stream';
import { mapVerification } from '../compute/verification';
import type { BenchmarkReport, BenchmarkTransport, Progress, RequestResult } from '../compute/types';

let activeRun=false;
const pendingOperations=new Set<Promise<unknown>>();
function track<T>(promise:Promise<T>):Promise<T>{
  pendingOperations.add(promise);
  promise.then(()=>pendingOperations.delete(promise),()=>pendingOperations.delete(promise));
  return promise;
}
export class BenchmarkError extends Error {}
class DeadlineError extends Error {}
class CancelledError extends Error {}
function bounded<T>(operation:Promise<T>,signal:AbortSignal,timeoutMs:number,onTimeout:()=>void):Promise<T> {
  return new Promise((resolve,reject)=>{
    const abort=()=>{cleanup();reject(new CancelledError());};
    const timer=setTimeout(()=>{cleanup();reject(new DeadlineError());onTimeout();},timeoutMs);
    function cleanup(){clearTimeout(timer);signal.removeEventListener('abort',abort);}
    operation.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
  });
}
export type RunnerOptions={
  signal?:AbortSignal;
  onProgress?:(event:Progress)=>void;
  onActivity?:(event:{index:number;outputBytes:number})=>void;
  onIssue?:(issue:{code:ProviderErrorCode;message:string})=>void;
  // Test seams; production uses performance.now, UTC and cryptographically random IDs.
  now?:()=>number;wallTime?:()=>Date;runId?:()=>string;
};
export async function runBenchmark(input:unknown,transport:BenchmarkTransport,options:RunnerOptions={}):Promise<BenchmarkReport> {
  const config=configSchema.parse(input);
  if(!['live','test-fixture'].includes(transport.origin)||transport.capabilities.model!==config.model||transport.capabilities.streaming!==true||!Number.isSafeInteger(transport.capabilities.maxOutputTokens)||transport.capabilities.maxOutputTokens<config.maxOutputTokens)
    throw new BenchmarkError('The selected model has not been confirmed to support this streaming workload.');
  if(activeRun||pendingOperations.size)throw new BenchmarkError('A benchmark is already running in this process.');
  activeRun=true;
  const inferenceOnly=transport.origin==='live'||!!transport.provider;
  const now=options.now??(()=>performance.now());
  const wallTime=options.wallTime??(()=>new Date());
  const controller=new AbortController();
  let runExpired=false,haltScheduling=false,providerStopped=false,completed=0;
  const cancel=()=>controller.abort();
  const deadline=setTimeout(()=>{runExpired=true;controller.abort();},RUN_TIMEOUT_MS);
  options.signal?.addEventListener('abort',cancel,{once:true});
  if(options.signal?.aborted)controller.abort();
  const total=config.warmupRequests+config.measuredRequests;
  function notify(event:Progress) {try{options.onProgress?.(event);}catch{/* Observers cannot change measured outcomes. */}}
  const base=(index:number):RequestResult=>({index,phase:index<config.warmupRequests?'warmup':'measured',promptIndex:index%workload.prompts.length,
    status:'skipped',latencyMs:null,ttftMs:null,verificationMs:null,completionId:null,finishReason:null,outputTokens:null,tokenSource:'unavailable',tokenScope:'unavailable',throughputTokensPerSecond:null,outputBytes:0,errorCode:'not_started',verification:mapVerification()});
  const results=Array.from({length:total},(_,index)=>base(index));
  async function attempt(index:number) {
    const result=base(index),collector=new StreamCollector(),requestController=new AbortController();
    const abort=()=>requestController.abort();controller.signal.addEventListener('abort',abort,{once:true});
    if(controller.signal.aborted)requestController.abort();
    let iterator:AsyncIterator<unknown>|undefined;
    let accepting=true;
    notify({stage:result.phase,index,completed,total,status:null});
    const start=now();
    try {
      const consume=track((async()=>{
        const stream=await transport.open(requestBody(config,index),requestController.signal);
        if(!accepting||requestController.signal.aborted)return;
        iterator=stream[Symbol.asyncIterator]();
        for(;;){
          const next=await iterator.next();
          if(!accepting||requestController.signal.aborted)return;
          if(next.done)break;
          const before=collector.outputBytes;
          collector.accept(next.value,now()-start);
          if(collector.outputBytes>before){try{options.onActivity?.({index,outputBytes:collector.outputBytes});}catch{/* Observation only. */}}
        }
        collector.finish();
      })());
      await bounded(consume,controller.signal,config.requestTimeoutMs,()=>requestController.abort());
      result.latencyMs=now()-start;
      if(!Number.isFinite(result.latencyMs)||result.latencyMs<0)throw new StreamError('invalid_stream');
      Object.assign(result,{status:'success',errorCode:null,...tokenUsage(collector.reportedTokens,collector.outputBytes,result.latencyMs,!inferenceOnly)});
      if(transport.verify&&collector.completionId){
        notify({stage:'verifying',index,completed,total,status:null});
        const verificationStart=now();
        try {
          const observation=await bounded(track(Promise.resolve().then(()=>transport.verify!(collector.completionId!,requestController.signal))),controller.signal,VERIFICATION_TIMEOUT_MS,()=>requestController.abort());
          result.verification=mapVerification(observation);
        }catch(e){
          result.verification=mapVerification({status:e instanceof DeadlineError||e instanceof CancelledError?'unavailable':'failed'});
          if(e instanceof DeadlineError)haltScheduling=true;
        }
        result.verificationMs=now()-verificationStart;
      }else result.verification=mapVerification(inferenceOnly?undefined:{status:'unavailable'});
    }catch(e){
      result.latencyMs=Math.max(0,now()-start);
      if(e instanceof DeadlineError){result.status='timed_out';result.errorCode='timeout';haltScheduling=true;}
      else if(e instanceof CancelledError||controller.signal.aborted){result.status=runExpired?'timed_out':'cancelled';result.errorCode=runExpired?'timeout':'cancelled';}
      else if(e instanceof ProviderError&&inferenceOnly){
        result.status=e.code==='provider_timeout'?'timed_out':'failed';result.errorCode=e.code==='provider_timeout'?'timeout':e.code;
        haltScheduling=true;providerStopped=true;
        try{options.onIssue?.({code:e.code,message:e.message});}catch{/* Observers cannot alter request outcomes. */}
      }else {
        result.status='failed';result.errorCode=e instanceof StreamError?e.code:'request_failed';
        if(inferenceOnly){
          haltScheduling=true;providerStopped=true;
          const issue=new ProviderError('invalid_provider_response',transport.provider);
          const message=e instanceof StreamError&&e.code==='empty_output'
            ?`${providerNames[issue.provider]} returned a completed stream without answer content.${collector.finishReason==='length'?' The output limit was reached and may have been exhausted before answer content was generated.':''} Finish reason: ${collector.finishReason??'not reported'}. Provider completion tokens: ${collector.reportedTokens??'not reported'}; reasoning tokens: ${collector.reportedReasoningTokens??'not reported'}. No automatic retry was made.`
            :issue.message;
          try{options.onIssue?.({code:issue.code,message});}catch{/* Observation only. */}
        }
      }
      result.throughputTokensPerSecond=null;
    }finally{
      accepting=false;requestController.abort();controller.signal.removeEventListener('abort',abort);
      // Never block a deadline on a non-cooperative iterator's return().
      if(iterator?.return)void Promise.resolve().then(()=>iterator!.return!()).catch(()=>{});
      result.ttftMs=collector.ttftMs;result.outputBytes=collector.outputBytes;
      result.completionId=collector.completionId;result.finishReason=collector.finishReason;
      results[index]=result;completed++;
      notify({stage:result.phase,index,completed,total,status:result.status});
    }
  }
  try {
    const startedAt=wallTime().toISOString(),start=now(),runId=(options.runId??randomUUID)();
    for(let i=0;i<config.warmupRequests&&!controller.signal.aborted&&!haltScheduling;i++)await attempt(i);
    let cursor=config.warmupRequests;
    async function worker(){while(!controller.signal.aborted&&!haltScheduling){const index=cursor++;if(index>=total)return;await attempt(index);}}
    await Promise.all(Array.from({length:config.concurrency},()=>worker()));
    const report:BenchmarkReport={application:'veyra-compute',schemaVersion:inferenceOnly?2:1,runId,origin:transport.origin,startedAt,completedAt:wallTime().toISOString(),durationMs:now()-start,
      status:runExpired?'deadline_exceeded':controller.signal.aborted?'cancelled':providerStopped?'provider_error':haltScheduling?'transport_stalled':'completed',config:configurationSnapshot(config,transport.provider??(transport.origin==='live'?'near-ai-cloud':undefined)),
      requests:results,statistics:statistics(results),verification:verificationSummary(results)};
    notify({stage:'finished',index:total,completed,total,status:null});
    return report;
  }finally{clearTimeout(deadline);options.signal?.removeEventListener('abort',cancel);activeRun=false;}
}
