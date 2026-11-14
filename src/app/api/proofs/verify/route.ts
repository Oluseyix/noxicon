import { z } from 'zod';
import { authorizeProofRequest, readProofInput, proofResponse, proofFailure } from '../../../../lib/server/proof-http';
import { proofConfiguration } from '../../../../lib/server/proof-config';
import { createProofRpc } from '../../../../lib/server/proof-rpc';
import { verifyProof } from '../../../../lib/server/proof-near';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  authorizeProofRequest(request);
  const input=z.object({report:z.unknown(),receipt:z.unknown()}).strict().parse(await readProofInput(request));
  const config=proofConfiguration();
  return proofResponse(await verifyProof(input.report,input.receipt,config.publisher,createProofRpc(config.verifyRpcUrl)));
 }catch(error){return proofFailure(error);}
}
