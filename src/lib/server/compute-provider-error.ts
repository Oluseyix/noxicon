import 'server-only';
import type { ProviderErrorCode } from '../compute/provider-errors';
import { providerNames, type CloudProviderId } from '../compute/providers';
const messages:Record<ProviderErrorCode,string>={
 invalid_credentials:'NEAR AI Cloud rejected the API key or its permissions. Check the server credential and restart before trying again.',
 insufficient_credits:'NEAR AI Cloud reports insufficient credits or an exhausted spending limit. Check billing and the API key spending limit before starting another test.',
 provider_rate_limit:'NEAR AI Cloud rate-limited this test. No automatic retry was made. Wait before starting another test.',
 model_unavailable:'The selected NEAR AI Cloud model is unavailable. Refresh models and choose an available model.',
 provider_rejected_request:'NEAR AI Cloud rejected the fixed benchmark request. Refresh models or choose another compatible model; no settings were silently changed.',
 provider_unavailable:'NEAR AI Cloud is temporarily unavailable. No automatic retry was made.',
 network_error:'The connection to NEAR AI Cloud failed. Check server connectivity before starting another test.',
 provider_timeout:'The NEAR AI Cloud request timed out. No automatic retry was made.',
 invalid_provider_response:'NEAR AI Cloud returned an invalid or incomplete response. No automatic retry was made.',
};
export class ProviderError extends Error {
 constructor(public code:ProviderErrorCode,public provider:CloudProviderId='near-ai-cloud'){
  super(provider==='groq'&&code==='insufficient_credits'
   ?'Groq free-tier quota or access is unavailable. This test is blocked; no automatic retry, upgrade or provider fallback was made.'
   :messages[code].replaceAll('NEAR AI Cloud',providerNames[provider]));
 }
}
export function providerHttpError(status:number,code?:unknown,provider:CloudProviderId='near-ai-cloud'){
 const error=(code:ProviderErrorCode)=>new ProviderError(code,provider);
 if(status===401||status===403)return error('invalid_credentials');
 if(status===402||['insufficient_quota','insufficient_credits','credit_balance_exhausted','spend_limit_exceeded'].includes(String(code)))return error('insufficient_credits');
 if(status===429||code==='rate_limit_exceeded')return error('provider_rate_limit');
 if(status===404||['model_not_found','model_unavailable','model_decommissioned'].includes(String(code)))return error('model_unavailable');
 if(status===408||status===504)return error('provider_timeout');
 if(status===400||status===422)return error('provider_rejected_request');
 return error('provider_unavailable');
}
