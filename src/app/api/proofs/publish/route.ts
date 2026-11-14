import { z } from 'zod';
import { authorizeProofRequest, readProofInput, proofResponse, proofFailure } from '../../../../lib/server/proof-http';
import { proofConfiguration } from '../../../../lib/server/proof-config';
import { publishProof } from '../../../../lib/server/proof-publication';
import { hashSchema } from '../../../../lib/server/proof-format';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  authorizeProofRequest(request);
  const input=z.object({report:z.unknown(),approvedCommitment:hashSchema}).strict().parse(await readProofInput(request));
  request.signal.throwIfAborted();
  const result=await publishProof(input.report,input.approvedCommitment,proofConfiguration());
  return proofResponse(result,result.state==='confirmed'?200:result.state==='failed'?422:202);
 }catch(error){return proofFailure(error);}
}
