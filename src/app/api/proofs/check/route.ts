import { z } from 'zod';
import { assertBenchmarkOrigin } from '../../../../lib/server/compute-http';
import { readProofInput, proofResponse, proofFailure } from '../../../../lib/server/proof-http';
import { accountSchema, ProofError } from '../../../../lib/server/proof-format';
import { TESTNET_RPCS } from '../../../../lib/server/proof-config';
import { createProofRpc } from '../../../../lib/server/proof-rpc';
import { verifyProof } from '../../../../lib/server/proof-near';
export const runtime='nodejs';
export const maxDuration=30;
let started=Date.now(),requests=0;
// Read-only verification. Trust comes from deployment configuration, never the uploaded receipt.
export async function POST(request:Request){
 try{
  assertBenchmarkOrigin(request);
  if(Date.now()-started>=60000){started=Date.now();requests=0;}
  if(++requests>30)throw new ProofError('request_limit','Verification is busy. Try again in a minute.',429);
  const input=z.object({report:z.unknown(),receipt:z.unknown()}).strict().parse(await readProofInput(request));
  const publisher=accountSchema.parse(process.env.NEAR_TESTNET_PUBLISHER??'veyra-proof.testnet');
  const rpcUrl=process.env.NEAR_TESTNET_VERIFY_RPC_URL??'https://archival-rpc.testnet.near.org';
  if(!TESTNET_RPCS.some(url=>url===rpcUrl))throw new ProofError('configuration','The verification RPC is not configured for NEAR Testnet.',503);
  const result=await verifyProof(input.report,input.receipt,publisher,createProofRpc(rpcUrl,fetch,10000));
  return proofResponse({...result,publisher});
 }catch(error){return proofFailure(error);}
}
