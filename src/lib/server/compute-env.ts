import 'server-only';
import { BoundaryError } from './compute-http';
import { cloudProviderSchema, type CloudProviderId } from '../compute/providers';

export const NEAR_CLOUD_BASE_URL='https://cloud-api.near.ai/v1/';
export const GROQ_BASE_URL='https://api.groq.com/openai/v1/';
export const REQUIRED_NODE_VERSION='24.22.1';
export function supportedRuntime(version=process.versions.node){
 // Workers exposes a compatibility version, not the runtime's actual capabilities.
 if(version===process.versions.node && typeof navigator!=='undefined' && navigator.userAgent==='Cloudflare-Workers')return true;
 if(process.env.VERCEL && version===process.versions.node)return true;
 const [major,minor,patch]=version.split('.').map(Number);
 return major>24||(major===24&&(minor>22||(minor===22&&patch>=1)));
}
export function selectedProvider():CloudProviderId{
 const parsed=cloudProviderSchema.safeParse(process.env.VEYRA_COMPUTE_PROVIDER??'near-ai-cloud');
 if(!parsed.success)throw new BoundaryError(503,'Set VEYRA_COMPUTE_PROVIDER to near-ai-cloud or groq. No inference requests were sent.');
 return parsed.data;
}
export function computeConfiguration(provider:CloudProviderId=selectedProvider()){
 if(!supportedRuntime())throw new BoundaryError(503,`Live testing requires Node.js ${REQUIRED_NODE_VERSION} or newer. Restart the server with the version in .nvmrc. No inference requests were sent.`);
 const variable=provider==='groq'?'GROQ_API_KEY':'NEAR_AI_API_KEY';
 const key=process.env[variable]?.trim();
 if(!key||/[\r\n]/.test(key))throw new BoundaryError(503,`Set ${variable} in the server environment and restart. No inference requests were sent.`);
 if(provider==='groq'&&process.env.GROQ_FREE_TIER_CONFIRMED!=='true')throw new BoundaryError(503,'Groq free-tier access must be confirmed in your Groq account before setting GROQ_FREE_TIER_CONFIRMED=true. If free access is unavailable, this benchmark is blocked. No inference requests were sent.');
 return key;
}
