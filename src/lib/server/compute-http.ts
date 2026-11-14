import 'server-only';
export class BoundaryError extends Error {constructor(public status:number,message:string){super(message);}}

// Deployment markers can be disabled in Vercel project settings.
const hosted = () => process.env.NODE_ENV === 'production' || !!process.env.VERCEL || !!process.env.VERCEL_DEPLOYMENT_ID;

function isAllowedHost(url: URL): boolean {
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
  if (hosted()) return true;
  return false;
}

export function assertBenchmarkOrigin(request:Request) {
  const url=new URL(request.url);
  const host=request.headers.get('x-forwarded-host')||request.headers.get('host')||url.host;
  if(request.headers.get('sec-fetch-site')==='cross-site')throw new BoundaryError(403,'Same-origin requests only.');
  const origin=request.headers.get('origin');
  if(!origin) throw new BoundaryError(403,'Benchmark writes are limited to this local application.');
  
  if(!isAllowedHost(url) || request.headers.get('host')!==url.host || origin!==url.origin) {
    if(hosted()) {
      try {
        const originUrl = new URL(origin);
        if(!['http:','https:'].includes(originUrl.protocol) || (originUrl.host !== host)) {
          throw new BoundaryError(403,'Benchmark writes are limited to this application.');
        }
      } catch {
        throw new BoundaryError(403,'Benchmark writes are limited to this application.');
      }
    } else {
      throw new BoundaryError(403,'Benchmark writes are limited to this local application.');
    }
  }
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
  const host=request.headers.get('x-forwarded-host')||request.headers.get('host')||url.host;
  if(!isAllowedHost(url) || (request.headers.get('host') && request.headers.get('host')!==url.host)) {
    if(hosted()) {
      // Allowed on Vercel deployment
    } else {
      throw new BoundaryError(403,'Model discovery is limited to this local application.');
    }
  }
  if(request.headers.get('sec-fetch-site')==='cross-site')throw new BoundaryError(403,'Same-origin requests only.');
  const origin=request.headers.get('origin');
  if(origin) {
    if(origin!==url.origin) {
      if(hosted()) {
        try {
          const originUrl=new URL(origin);
          if(!['http:','https:'].includes(originUrl.protocol) || (originUrl.host!==host)) {
            throw new BoundaryError(403,'Model discovery must originate from this application.');
          }
        } catch {
          throw new BoundaryError(403,'Model discovery must originate from this application.');
        }
      } else {
        throw new BoundaryError(403,'Model discovery must originate from this local application.');
      }
    }
  } else if(!(request.method==='GET'&&(!request.headers.has('sec-fetch-site')||request.headers.get('sec-fetch-site')==='same-origin'||request.headers.get('sec-fetch-site')==='none'))) {
    throw new BoundaryError(403,'Model discovery must originate from this local application.');
  }
}
