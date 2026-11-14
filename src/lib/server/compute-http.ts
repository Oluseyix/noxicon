import 'server-only';
export class BoundaryError extends Error {constructor(public status:number,message:string){super(message);}}
export function assertBenchmarkOrigin(request:Request) {
  const url=new URL(request.url);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||request.headers.get('host')!==url.host||request.headers.get('origin')!==url.origin)
    throw new BoundaryError(403,'Benchmark writes are limited to this local application.');
}
export async function readBenchmarkInput(request:Request):Promise<unknown> {
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new BoundaryError(415,'Expected application/json.');
  const reader=request.body?.getReader();if(!reader)throw new BoundaryError(400,'Missing request body.');
  const bytes:number[]=[];
  let timer:ReturnType<typeof setTimeout>|undefined;
  const read=async()=>{
    for(;;){const {value,done}=await reader.read();if(done)break;if(bytes.length+value.length>2048){await reader.cancel();throw new BoundaryError(413,'Benchmark configuration exceeds 2 KB.');}bytes.push(...value);}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes)));}catch{throw new BoundaryError(400,'Invalid JSON configuration.');}
  };
  try {
    const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new BoundaryError(408,'Benchmark configuration body timed out.'));},5000);});
    return await Promise.race([read(),deadline]);
  }finally{if(timer)clearTimeout(timer);reader.releaseLock();}
}
export function assertBenchmarkReadOrigin(request:Request){
 const url=new URL(request.url);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||request.headers.get('host')!==url.host)
  throw new BoundaryError(403,'Model discovery is limited to this local application.');
 if(request.headers.get('origin')!==url.origin&&!(request.method==='GET'&&!request.headers.has('origin')&&request.headers.get('sec-fetch-site')==='same-origin'))
  throw new BoundaryError(403,'Model discovery must originate from this local application.');
}
