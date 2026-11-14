import 'server-only';
import { z } from 'zod';
import { computeConfiguration, NEAR_CLOUD_BASE_URL } from './compute-env';
import { ProviderError } from './compute-provider-error';
import { createCloudAdapter, type AdapterOptions, type ComputeModel } from './compute-cloud';
export type { ComputeModel } from './compute-cloud';

const modelSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/).max(200),name:z.string().min(1).max(200).optional(),is_ready:z.boolean().optional(),max_output_length:z.number().int().positive(),input_modalities:z.array(z.string()),output_modalities:z.array(z.string()),supported_sampling_parameters:z.array(z.string())});
export function parseCatalog(value:unknown):ComputeModel[]{
 const catalog=z.object({data:z.array(z.unknown()).max(2000)}).safeParse(value);
 if(!catalog.success)throw new ProviderError('invalid_provider_response');
 const models=new Map<string,ComputeModel>();
 for(const item of catalog.data.data){const result=modelSchema.safeParse(item);if(!result.success)continue;const m=result.data;
  if(m.is_ready===false||m.max_output_length<16||!m.input_modalities.includes('text')||!m.output_modalities.includes('text')||!['temperature','top_p','max_tokens'].every(p=>m.supported_sampling_parameters.includes(p)))continue;
  models.set(m.id,{id:m.id,name:m.name||m.id,maxOutputTokens:Math.min(256,m.max_output_length)});
 }
 return [...models.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function createNearCloudAdapter(options:AdapterOptions={}){
 return createCloudAdapter({id:'near-ai-cloud',baseUrl:NEAR_CLOUD_BASE_URL,credential:()=>computeConfiguration('near-ai-cloud'),parseCatalog},options);
}
export const {discoverModels,prepareTransport}=createNearCloudAdapter();
