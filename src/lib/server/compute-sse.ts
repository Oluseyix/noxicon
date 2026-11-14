import 'server-only';
import type { CloudProviderId } from '../compute/providers';
import { ProviderError, providerHttpError } from './compute-provider-error';

// Bounded OpenAI-compatible SSE framing. StreamCollector remains responsible for
// content, completion, usage and monotonic metric validation.
export async function* readProviderEvents(body:ReadableStream<Uint8Array>,signal:AbortSignal,provider:CloudProviderId='near-ai-cloud'):AsyncGenerator<unknown>{
 const reader=body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let buffer='',data:string[]=[],eventType='',eventSize=0,total=0,ended=false;
 const abort=()=>{void reader.cancel().catch(()=>{});};
 signal.addEventListener('abort',abort,{once:true});
 function event(){
  const text=data.join('\n');data=[];eventSize=0;const type=eventType;eventType='';
  if(!text)return undefined;
  if(text.trim()==='[DONE]'){ended=true;return undefined;}
  let value:unknown;try{value=JSON.parse(text);}catch{throw new ProviderError('invalid_provider_response',provider);}
  if(type==='error'||(value!==null&&typeof value==='object'&&'error' in value)){
   const error=(value as {error?:{code?:unknown;status?:unknown}})?.error;
   throw providerHttpError(typeof error?.status==='number'?error.status:500,error?.code,provider);
  }
  return value;
 }
 try{
  signal.throwIfAborted();
  while(!ended){
   const {value,done}=await reader.read();signal.throwIfAborted();
   if(!done){total+=value.byteLength;if(total>4*1024*1024)throw new ProviderError('invalid_provider_response',provider);}
   try{buffer+=done?decoder.decode():decoder.decode(value,{stream:true});}catch{throw new ProviderError('invalid_provider_response',provider);}
   // Supports LF, CRLF and CR, including a CRLF split across network chunks.
   for(;;){const index=buffer.search(/[\r\n]/);if(index<0)break;if(buffer[index]==='\r'&&index===buffer.length-1&&!done)break;
    const line=buffer.slice(0,index),skip=buffer[index]==='\r'&&buffer[index+1]==='\n'?2:1;buffer=buffer.slice(index+skip);
    if(line===''){const parsed=event();if(parsed!==undefined)yield parsed;if(ended)break;}
    else if(!line.startsWith(':')){const colon=line.indexOf(':'),name=colon<0?line:line.slice(0,colon);let content=colon<0?'':line.slice(colon+1);if(content.startsWith(' '))content=content.slice(1);
     if(name==='data'){eventSize+=content.length;if(eventSize>262144)throw new ProviderError('invalid_provider_response',provider);data.push(content);}else if(name==='event')eventType=content;
    }
   }
   if(buffer.length>262144)throw new ProviderError('invalid_provider_response',provider);
   if(done)break;
  }
  if(!ended)throw new ProviderError('invalid_provider_response',provider);
 }catch(error){if(signal.aborted)throw signal.reason;if(error instanceof ProviderError)throw error;throw new ProviderError(error instanceof TypeError?'network_error':'invalid_provider_response',provider);}
 finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
