import 'server-only';
import { AiError } from './near-ai';
const headers={'Cache-Control':'no-store'};
export function json(value:unknown,status=200){return Response.json(value,{status,headers});}
// The app has no authenticated users yet. Do not expose a paid inference proxy on deployment.
export function assertLocalRequest(request:Request) {
  const url=new URL(request.url);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||request.headers.get('host')!==url.host)
    throw new AiError('LOCAL_ONLY','AI integration is limited to the local demo until authenticated access is implemented.',403);
  if(request.headers.get('origin')!==url.origin && !(request.method==='GET'&&!request.headers.get('origin')&&request.headers.get('sec-fetch-site')==='same-origin'))
    throw new AiError('ORIGIN_REJECTED','AI requests must originate from this local application.',403);
}
export function failure(error:unknown) {
  if(error instanceof AiError)return json({error:{code:error.code,message:error.message}},error.status);
  // Never reflect upstream response bodies, prompts or credentials.
  return json({error:{code:'AI_UNAVAILABLE',message:'AI verification could not complete. No AI output was released.'}},502);
}
export async function readSmallJson(request:Request) {
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new AiError('INVALID_REQUEST','Expected a JSON request.',415);
  const reader=request.body?.getReader();
  if(!reader)throw new AiError('INVALID_REQUEST','Missing request body.',400);
  let size=0;const chunks:Uint8Array[]=[];
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new AiError('INVALID_REQUEST','AI requests are limited to approved aggregates (4 KB maximum).',413);}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AiError('INVALID_REQUEST','Invalid JSON.',400);}
  } finally {reader.releaseLock();}
}
