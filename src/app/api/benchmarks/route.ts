import { configSchema } from '../../../lib/compute/config';
import { assertBenchmarkOrigin, BoundaryError, readBenchmarkInput } from '../../../lib/server/compute-http';
import { computeConfiguration } from '../../../lib/server/compute-env';
import { ProviderError } from '../../../lib/server/compute-provider-error';
import { computeProvider } from '../../../lib/server/compute-provider';
import { reserveRun } from '../../../lib/server/compute-budget';
import { runBenchmark } from '../../../lib/server/compute-runner';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 let release:(()=>void)|undefined;
 try{
  assertBenchmarkOrigin(request);
  const parsed=configSchema.safeParse(await readBenchmarkInput(request));
  if(!parsed.success)throw new BoundaryError(400,'Invalid benchmark configuration. Only supported workload settings are accepted.');
  const provider=computeProvider();
  computeConfiguration(provider.id);
  release=reserveRun(parsed.data);
  const controller=new AbortController();const disconnect=()=>controller.abort();request.signal.addEventListener('abort',disconnect,{once:true});
  if(request.signal.aborted)controller.abort();
  const encoder=new TextEncoder();let closed=false;
  const body=new ReadableStream<Uint8Array>({
   start(stream){
    const send=(event:unknown)=>{if(!closed){try{stream.enqueue(encoder.encode(JSON.stringify(event)+'\n'));}catch{closed=true;controller.abort();}}};
    // Covers bounded discovery plus the engine's 120-second run deadline.
    const timer=setTimeout(()=>{send({type:'error',message:'The test deadline was reached. Try a smaller test.'});controller.abort();if(!closed){closed=true;stream.close();}},136000);
    void (async()=>{
     let session:Awaited<ReturnType<typeof provider.prepareTransport>>|undefined;
     try{
      send({type:'preparing'});session=await provider.prepareTransport(parsed.data,controller.signal);controller.signal.throwIfAborted();
      let warning:string|undefined;
      const report=await runBenchmark(parsed.data,session.transport,{signal:controller.signal,onProgress:progress=>send({type:'progress',progress}),onActivity:activity=>send({type:'activity',...activity}),onIssue:issue=>{warning??=issue.message;}});
      send({type:'report',report,...(warning?{warning}:{})});
     }catch(error){send({type:'error',message:error instanceof BoundaryError||error instanceof ProviderError?error.message:'The test could not complete. Retry or choose another model.'});}
     finally{clearTimeout(timer);session?.close();release?.();request.signal.removeEventListener('abort',disconnect);if(!closed){closed=true;stream.close();}}
    })();
   },cancel(){closed=true;controller.abort();},
  });
  return new Response(body,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'}});
 }catch(error){release?.();const status=error instanceof BoundaryError?error.status:500;return Response.json({error:{message:error instanceof BoundaryError?error.message:'The test could not start.'}},{status,headers:{'Cache-Control':'no-store'}});}
}
