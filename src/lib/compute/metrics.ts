import type { Distribution, RequestResult, Statistics, VerificationSummary } from './types';
export function percentile(values:readonly number[],percent:number):number|null {
  if(!Number.isFinite(percent)||percent<=0||percent>100)throw new Error('Percentile must be in (0, 100]');
  if(values.some(v=>!Number.isFinite(v)||v<0))throw new Error('Invalid metric sample');
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.ceil(percent/100*sorted.length)-1];
}
export function distribution(values:number[]):Distribution {
  return {samples:values.length,p50:percentile(values,50),p95:percentile(values,95),mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
}
export function tokenUsage(reported:number|null,bytes:number,latencyMs:number,estimateMissing=true) {
  if(!Number.isSafeInteger(bytes)||bytes<0||!Number.isFinite(latencyMs)||latencyMs<0)throw new Error('Invalid usage inputs');
  if(reported!==null&&(!Number.isSafeInteger(reported)||reported<0))throw new Error('Invalid reported completion tokens');
  if(reported===null&&!estimateMissing)return {outputTokens:null,tokenSource:'unavailable' as const,tokenScope:'unavailable' as const,throughputTokensPerSecond:null};
  const outputTokens=reported??Math.ceil(bytes/4);
  return {outputTokens,tokenSource:reported===null?'estimated' as const:'reported' as const,
    tokenScope:reported===null?'visible_text_utf8_bytes_div_4' as const:'provider_completion_including_reasoning' as const,
    throughputTokensPerSecond:latencyMs>0?outputTokens/(latencyMs/1000):null};
}
export function statistics(requests:readonly RequestResult[]):Statistics {
  const measured=requests.filter(r=>r.phase==='measured');
  const success=measured.filter(r=>r.status==='success');
  const rates=(source:'reported'|'estimated')=>success.filter(r=>r.tokenSource===source&&r.throughputTokensPerSecond!==null).map(r=>r.throughputTokensPerSecond!);
  return {planned:measured.length,attempted:measured.filter(r=>r.status!=='skipped').length,successful:success.length,
    failed:measured.filter(r=>['failed','timed_out','cancelled'].includes(r.status)).length,
    timedOut:measured.filter(r=>r.status==='timed_out').length,cancelled:measured.filter(r=>r.status==='cancelled').length,skipped:measured.filter(r=>r.status==='skipped').length,
    latencyMs:distribution(success.map(r=>r.latencyMs!)),ttftMs:distribution(success.map(r=>r.ttftMs!)),
    throughput:{definition:'completion_tokens_per_total_request_second',reported:distribution(rates('reported')),estimated:distribution(rates('estimated'))}};
}
export function verificationSummary(requests:readonly RequestResult[]):VerificationSummary {
  const rows=requests.filter(r=>r.phase==='measured');
  return {providerTee:rows.filter(r=>r.verification.status==='provider_tee').length,gpuTee:rows.filter(r=>r.verification.gpuTeeVerified).length,
    gateway:rows.filter(r=>r.verification.status==='gateway').length,failed:rows.filter(r=>r.verification.status==='failed').length,
    unavailable:rows.filter(r=>r.verification.status==='unavailable').length,notRequested:rows.filter(r=>r.verification.status==='not_requested').length};
}
