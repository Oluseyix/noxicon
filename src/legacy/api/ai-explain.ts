import { explanationRequestSchema } from '../../lib/ai-contract';
import { AiError, explain } from '../../lib/server/near-ai';
import { assertLocalRequest, failure, json, readSmallJson } from '../../lib/server/ai-http';
export const runtime='nodejs';
export const maxDuration=120;
let inFlight=false;
let nextAllowed=0;
export async function POST(request:Request) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    assertLocalRequest(request);
    const parsed=explanationRequestSchema.safeParse(await readSmallJson(request));
    if(!parsed.success)throw new AiError('INVALID_REQUEST','Only an explicitly approved, valid aggregate disclosure is accepted. Raw records and additional fields are rejected.',400);
    if(inFlight||Date.now()<nextAllowed)throw new AiError('BUSY','An AI request is already running or was just submitted. Wait a few seconds before retrying.',429);
    inFlight=true;nextAllowed=Date.now()+5000;
    // Retain the lock if SDK verification outlives the HTTP deadline.
    const operation=explain(parsed.data).finally(()=>{inFlight=false;});
    const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AiError('VERIFICATION_TIMEOUT','NEAR AI verification timed out. No AI output was released.',504)),100000);});
    return json(await Promise.race([operation,deadline]));
  } catch(e){return failure(e);}finally{if(timer)clearTimeout(timer);}
}
