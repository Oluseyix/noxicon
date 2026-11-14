import { z } from 'zod';
import { assertBenchmarkOrigin } from '../../../../lib/server/compute-http';
import { readProofInput, proofResponse, proofFailure } from '../../../../lib/server/proof-http';
import { accountSchema, ProofError, receiptSchema } from '../../../../lib/server/proof-format';
import { verifyProof } from '../../../../lib/server/proof-near';
import { createProofRpc } from '../../../../lib/server/proof-rpc';
export const runtime='nodejs';
export const maxDuration=60;
let active=0;
export async function POST(request:Request){
 let admitted=false;
 try{
  assertBenchmarkOrigin(request);
  if(active>=4)throw new ProofError('busy','Verification is busy. Try again shortly.',429);
  active++;admitted=true;
  const input=z.object({report:z.unknown(),receipt:receiptSchema}).strict().parse(await readProofInput(request));
  const publisher=accountSchema.safeParse(process.env.NEAR_TESTNET_PUBLISHER);
  if(!publisher.success)throw new ProofError('configuration','The server publisher has not been configured.',503);
  let result=await verifyProof(input.report,input.receipt,publisher.data,createProofRpc('https://archival-rpc.testnet.fastnear.com',fetch,8000));
  if(result.status==='unavailable')result=await verifyProof(input.report,input.receipt,publisher.data,createProofRpc('https://archival-rpc.testnet.near.org',fetch,8000));
  return proofResponse(result);
 }catch(error){return proofFailure(error);}finally{if(admitted)active--;}
}
