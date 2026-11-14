import 'server-only';
import { resolve } from 'node:path';
import { baseDecode, baseEncode, KeyPair, KeyPairSigner } from 'near-api-js';
import { accountSchema, ProofError } from './proof-format';
import { keychainSigner, type ProofSigner } from './proof-keychain';

export const TESTNET_RPCS=['https://test.rpc.fastnear.com','https://archival-rpc.testnet.fastnear.com','https://archival-rpc.testnet.near.org'] as const;
export type ProofConfiguration={publisher:string;rpcUrl:string;verifyRpcUrl:string;stateDirectory:string};
function endpoint(value:string|undefined,fallback:string){
 const url=value??fallback;
 if(!TESTNET_RPCS.some(allowed=>allowed===url))throw new ProofError('configuration','Only the documented Testnet RPC URLs are allowed.',503);
 return url;
}
export function proofConfiguration():ProofConfiguration{
 if(process.env.VEYRA_PROOF_NETWORK!=='testnet')throw new ProofError('configuration','Set VEYRA_PROOF_NETWORK=testnet. Mainnet is not supported.',503);
 const publisher=accountSchema.safeParse(process.env.NEAR_TESTNET_PUBLISHER);
 if(!publisher.success)throw new ProofError('configuration','Set NEAR_TESTNET_PUBLISHER to the dedicated, allowlisted named Testnet account.',503);
 return {publisher:publisher.data,rpcUrl:endpoint(process.env.NEAR_TESTNET_RPC_URL,TESTNET_RPCS[0]),
  verifyRpcUrl:endpoint(process.env.NEAR_TESTNET_VERIFY_RPC_URL,TESTNET_RPCS[1]),
  stateDirectory:resolve(process.env.VEYRA_PROOF_STATE_DIR??'.veyra-proof-state')};
}
export function publicationSigner(options:{allowKeychain?:boolean}={}):ProofSigner{
 if(process.env.VEYRA_PROOF_PUBLICATION_ENABLED!=='true')throw new ProofError('disabled','Publication is disabled. Enable it only for an explicitly approved Testnet transaction.',503);
 const method=process.env.NEAR_TESTNET_SIGNER??'private-key';
 if(method==='keychain'){
  if(!options.allowKeychain)throw new ProofError('keychain_cli_only','Keychain signing is available only through the explicit local proof CLI.',403);
  return keychainSigner(proofConfiguration().publisher,process.env.NEAR_TESTNET_PUBLIC_KEY,process.env.NEAR_TESTNET_CLI_PATH);
 }
 if(method!=='private-key')throw new ProofError('key_configuration','NEAR_TESTNET_SIGNER must be private-key or keychain. No automatic fallback is allowed.',503);
 const secret=process.env.NEAR_TESTNET_PRIVATE_KEY;
 if(!secret||!/^ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(secret))throw new ProofError('key_configuration','Configure a dedicated ed25519 Testnet private key on the backend.',503);
 try{
  const encoded=secret.slice(8),bytes=baseDecode(encoded);
  if(bytes.length!==64||baseEncode(bytes)!==encoded)throw new Error('key');
  const pair=KeyPair.fromString(secret as `ed25519:${string}`);
  if(!Buffer.from(pair.getPublicKey().data).equals(Buffer.from(bytes.subarray(32))))throw new Error('key');
  return new KeyPairSigner(pair);
 }catch{throw new ProofError('key_configuration','The Testnet signing key is invalid. No transaction was submitted.',503);}
}
