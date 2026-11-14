import { z } from 'zod';
export const liveEventSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('preparing')}),
 z.object({type:z.literal('progress'),progress:z.object({stage:z.enum(['warmup','measured','verifying','finished']),index:z.number().int().min(0).max(10),completed:z.number().int().min(0).max(10),total:z.number().int().min(1).max(10),status:z.enum(['success','failed','timed_out','cancelled','skipped']).nullable()})}),
 z.object({type:z.literal('activity'),index:z.number().int().min(0).max(9),outputBytes:z.number().int().nonnegative()}),
 z.object({type:z.literal('report'),report:z.unknown(),warning:z.string().max(500).optional()}),
 z.object({type:z.literal('error'),message:z.string().max(500)}),
]);
export type LiveEvent=z.infer<typeof liveEventSchema>;
export async function readLiveEvents(response:Response,onEvent:(event:LiveEvent)=>Promise<void>|void){
 if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.error?.message||'The test could not start. Please try again.');}
 if(!response.body||!response.headers.get('content-type')?.includes('application/x-ndjson'))throw new Error('The test returned an invalid response.');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',terminal=false;
 const line=async(value:string)=>{if(!value.trim())return;if(terminal)throw new Error('Unexpected data after the test finished.');const event=liveEventSchema.parse(JSON.parse(value));if(event.type==='report'||event.type==='error')terminal=true;await onEvent(event);};
 try{for(;;){const {value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});if(buffer.length>300000)throw new Error('Test response exceeded the size limit.');let end;while((end=buffer.indexOf('\n'))>=0){await line(buffer.slice(0,end));buffer=buffer.slice(end+1);}if(done)break;}if(buffer.trim())await line(buffer);if(!terminal)throw new Error('The connection ended before a report arrived. Please retry.');}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
