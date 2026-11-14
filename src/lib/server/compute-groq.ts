import 'server-only';
import { z } from 'zod';
import { createCloudAdapter, type AdapterOptions, type ComputeModel } from './compute-cloud';
import { computeConfiguration, GROQ_BASE_URL } from './compute-env';
import { ProviderError } from './compute-provider-error';

const modelSchema=z.object({
 id:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/).max(200),
 active:z.boolean().optional(),context_window:z.number().int().positive(),
 max_completion_tokens:z.number().int().positive().optional(),
});
// Groq's catalog does not declare endpoint/modalities/sampling capabilities.
// Admit known plain chat families only; never offer compound tool systems,
// speech or guard models. IDs and availability still come solely from /models.
const chatFamily=/^(?:llama-|meta-llama\/llama-|qwen\/qwen|openai\/gpt-oss-|gemma|deepseek-r1-distill-llama-|moonshotai\/kimi-k2)/i;
export function parseGroqCatalog(value:unknown):ComputeModel[]{
 const catalog=z.object({data:z.array(z.unknown()).max(2000)}).safeParse(value);
 if(!catalog.success)throw new ProviderError('invalid_provider_response','groq');
 const models=new Map<string,ComputeModel>();
 for(const entry of catalog.data.data){
  const parsed=modelSchema.safeParse(entry);if(!parsed.success)continue;
  const m=parsed.data;
  if(m.active===false||m.context_window<512||!chatFamily.test(m.id)||/guard|safeguard|prompt-guard/i.test(m.id))continue;
  // 256 is our workload ceiling, not an invented provider capacity. Groq may
  // omit its output limit; unsupported requests fail once, without a fallback.
  const maxOutputTokens=Math.min(256,m.max_completion_tokens??256);
  if(maxOutputTokens<16)continue;
  models.set(m.id,{id:m.id,name:m.id,maxOutputTokens});
 }
 return [...models.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
function normalizeGroqEvent(event:unknown):unknown{
 if(!event||typeof event!=='object')return event;
 const value=event as Record<string,unknown>;
 const extension=value.x_groq;
 if(extension&&typeof extension==='object'&&'error' in extension&&extension.error!=null)throw new ProviderError('invalid_provider_response','groq');
 const usage=extension&&typeof extension==='object'&&'usage' in extension?extension.usage:undefined;
 if(usage!=null){
  const parsed=z.object({completion_tokens:z.number().int().nonnegative()}).safeParse(usage);
  if(!parsed.success)throw new ProviderError('invalid_provider_response','groq');
  if(value.usage!=null){
   const standard=z.object({completion_tokens:z.number().int().nonnegative()}).safeParse(value.usage);
   if(!standard.success||standard.data.completion_tokens!==parsed.data.completion_tokens)throw new ProviderError('invalid_provider_response','groq');
  }
  // Retain only bounded numeric diagnostic metadata, never reasoning text.
  const detailsSchema=z.object({completion_tokens_details:z.object({reasoning_tokens:z.number().int().nonnegative()})});
  const details=detailsSchema.safeParse(usage);
  const standardDetails=detailsSchema.safeParse(value.usage);
  const reasoning=details.success?details.data.completion_tokens_details.reasoning_tokens:standardDetails.success?standardDetails.data.completion_tokens_details.reasoning_tokens:null;
  return {...value,usage:{...parsed.data,...(reasoning!==null&&reasoning<=parsed.data.completion_tokens?{completion_tokens_details:{reasoning_tokens:reasoning}}:{})}};
 }
 return event;
}
export function createGroqAdapter(options:AdapterOptions={}){
 return createCloudAdapter({id:'groq',baseUrl:GROQ_BASE_URL,credential:()=>computeConfiguration('groq'),parseCatalog:parseGroqCatalog,
  encodeRequest:body=>{const {max_tokens,...rest}=body;return {...rest,max_completion_tokens:max_tokens,service_tier:'on_demand'};},
  normalizeEvent:normalizeGroqEvent,
 },options);
}
