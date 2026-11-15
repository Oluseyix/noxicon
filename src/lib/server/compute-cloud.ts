import 'server-only';
import { logProviderFailure } from './provider-diagnostics';
import type { BenchmarkConfig, requestBody } from '../compute/config';
import type { BenchmarkTransport } from '../compute/types';
import type { CloudProviderId } from '../compute/providers';
import { BoundaryError } from './compute-http';
import { ProviderError, providerHttpError } from './compute-provider-error';
import { readProviderEvents } from './compute-sse';

export type ComputeModel={id:string;name:string;maxOutputTokens:number};
export type AdapterOptions={request?:typeof fetch;credential?:()=>string};
export type CloudDefinition={
 id:CloudProviderId;baseUrl:string;credential:()=>string;
 parseCatalog:(value:unknown)=>ComputeModel[];
 encodeRequest?:(body:ReturnType<typeof requestBody>)=>unknown;
 normalizeEvent?:(event:unknown)=>unknown;
};
export type ComputeProvider=ReturnType<typeof createCloudAdapter>;
async function boundedJson(response:Response,signal:AbortSignal,limit:number):Promise<unknown>{
 if(!response.body)throw new ProviderError('invalid_provider_response');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{signal.throwIfAborted();for(;;){const {value,done}=await reader.read();signal.throwIfAborted();if(done)break;total+=value.byteLength;if(total>limit)throw new ProviderError('invalid_provider_response');chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function checkResponse(response:Response,signal:AbortSignal,provider:CloudProviderId,operation:'models'|'completion'){
 if(response.ok)return;
 logProviderFailure(provider,operation,undefined,response.status);
 // Workers rejects redirect:'error' before dispatch. Use manual mode and
 // reject redirects here, without following Location or forwarding credentials.
 if(response.status>=300&&response.status<400){
  void response.body?.cancel().catch(()=>{});
  throw new ProviderError('network_error',provider);
 }
 // Only use an allowlisted error code to distinguish quota from rate limiting.
 // Never retain or return the provider's free-form message/body.
 let code:unknown;
 try{const body=await boundedJson(response,signal,16384);code=(body as {error?:{code?:unknown}})?.error?.code;}catch{/* HTTP status still supplies a safe error. */}
 signal.throwIfAborted();throw providerHttpError(response.status,code,provider);
}
export function createCloudAdapter(definition:CloudDefinition,options:AdapterOptions={}){
 const request=options.request??((...args:Parameters<typeof fetch>)=>fetch(...args));
 const credential=options.credential??definition.credential;
 async function discoverModels(signal?:AbortSignal):Promise<ComputeModel[]>{
  const key=credential();signal?.throwIfAborted();
  const deadline=AbortSignal.timeout(15000),bounded=signal?AbortSignal.any([signal,deadline]):deadline;
  try{
   const response=await request(`${definition.baseUrl}models`,{headers:{Authorization:`Bearer ${key}`},cache:'no-store',redirect:'manual',signal:bounded});
   await checkResponse(response,bounded,definition.id,'models');
   let data:unknown;try{data=await boundedJson(response,bounded,1048576);}catch(error){if(bounded.aborted)throw error;throw new ProviderError('invalid_provider_response');}
   const models=definition.parseCatalog(data);if(models.some(m=>m.id.includes(key)||m.name.includes(key)))throw new ProviderError('invalid_provider_response');return models;
  }catch(error){if(!(error instanceof ProviderError))logProviderFailure(definition.id,'models',error);if(signal?.aborted)throw signal.reason;if(deadline.aborted)throw new ProviderError('provider_timeout',definition.id);if(error instanceof ProviderError)throw new ProviderError(error.code,definition.id);throw new ProviderError('network_error',definition.id);}
 }
 async function prepareTransport(config:BenchmarkConfig,signal:AbortSignal){
  const models=await discoverModels(signal);signal.throwIfAborted();
  const model=models.find(m=>m.id===config.model);
  if(!model)throw new ProviderError('model_unavailable',definition.id);
  if(model.maxOutputTokens<config.maxOutputTokens)throw new BoundaryError(400,'This model does not support the selected output limit. Lower the limit or choose another model.');
  const key=credential(),session=new AbortController();
  const transport:BenchmarkTransport={origin:options.request?'test-fixture':'live',provider:definition.id,capabilities:{model:model.id,streaming:true,maxOutputTokens:model.maxOutputTokens},
   async open(body,requestSignal){
    const linked=AbortSignal.any([signal,session.signal,requestSignal]);linked.throwIfAborted();
    let response:Response|undefined;
    const cancelUnread=()=>{if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});};
    try{
     // Exactly one dispatch. No retries, attestation preflight or signature calls.
     response=await request(`${definition.baseUrl}chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(definition.encodeRequest?.(body)??body),cache:'no-store',redirect:'manual',signal:linked});
     // Covers cancellation before the consumer acquires the SSE reader.
     linked.addEventListener('abort',cancelUnread,{once:true});
     if(linked.aborted){cancelUnread();linked.throwIfAborted();}
     await checkResponse(response,linked,definition.id,'completion');
     linked.throwIfAborted();
     if(!response.body||response.headers.get('content-type')?.split(';')[0].trim()!=='text/event-stream'){void response.body?.cancel().catch(()=>{});throw new ProviderError('invalid_provider_response');}
     const stream=response.body;
     return (async function*(){try{for await(const event of readProviderEvents(stream,linked,definition.id)){
      if(event&&typeof event==='object'&&'id' in event&&typeof event.id==='string'&&event.id.includes(key))throw new ProviderError('invalid_provider_response',definition.id);
      if(event&&typeof event==='object'&&'model' in event&&event.model!==model.id)throw new ProviderError('invalid_provider_response',definition.id);
      yield definition.normalizeEvent?.(event)??event;
     }}finally{linked.removeEventListener('abort',cancelUnread);cancelUnread();}})();
    }catch(error){if(!(error instanceof ProviderError))logProviderFailure(definition.id,'completion',error);linked.removeEventListener('abort',cancelUnread);cancelUnread();if(linked.aborted)throw linked.reason;if(error instanceof ProviderError)throw new ProviderError(error.code,definition.id);throw new ProviderError('network_error',definition.id);}
   },
  };
  return {transport,close:()=>session.abort()};
 }
 return {discoverModels,prepareTransport};
}

