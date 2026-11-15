import 'server-only';
import type { CloudProviderId } from '../compute/providers';
const codes=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
export function logProviderFailure(provider:CloudProviderId,operation:'models'|'completion',error:unknown,status?:number){
 const e=error instanceof Error?error:undefined;
 const cause=e?.cause as {code?:unknown}|undefined;
 const candidate=cause?.code??(e as Error&{code?:unknown})?.code;
 const code=typeof candidate==='string'&&codes.has(candidate)?candidate:undefined;
 const category=status===401?'invalid_credentials':status===403?'forbidden':status===429?'rate_limited':status!==undefined?'upstream_http_error':code==='ENOTFOUND'||code==='EAI_AGAIN'?'dns_failure':code?'network_failure':e?.message&&/unsupported cache mode|cache field.*not implemented/i.test(e.message)?'runtime_cache_incompatible':e?.name==='AbortError'||e?.name==='TimeoutError'?'timeout':e?.name==='TypeError'?'fetch_or_runtime_error':'provider_response_error';
 // Never serialize the exception, cause, headers, URLs, response body or env values.
 console.error(JSON.stringify({event:'provider_request_failed',provider,operation,category,...(status!==undefined?{upstreamStatus:status}:{}),...(code?{networkCode:code}:{})}));
}
export function logModelRouteFailure(kind:'boundary'|'provider'|'unexpected',status:number){
 console.error(JSON.stringify({event:'model_discovery_failed',kind,status,environment:{provider:process.env.VEYRA_COMPUTE_PROVIDER==='groq'?'groq':process.env.VEYRA_COMPUTE_PROVIDER==='near-ai-cloud'?'near-ai-cloud':process.env.VEYRA_COMPUTE_PROVIDER?'invalid':'unset',groqKeyPresent:!!process.env.GROQ_API_KEY,nearKeyPresent:!!process.env.NEAR_AI_API_KEY,groqFreeTierConfirmed:process.env.GROQ_FREE_TIER_CONFIRMED==='true',cloudflareRuntime:typeof navigator!=='undefined'&&navigator.userAgent==='Cloudflare-Workers'}}));
}
