import { logModelRouteFailure } from '../../../../lib/server/provider-diagnostics';
import { assertBenchmarkReadOrigin, BoundaryError } from '../../../../lib/server/compute-http';
import { computeProvider } from '../../../../lib/server/compute-provider';
import { ProviderError } from '../../../../lib/server/compute-provider-error';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(request:Request){
 try{
  assertBenchmarkReadOrigin(request);const provider=computeProvider();const models=await provider.discoverModels(request.signal);
  return Response.json({provider:provider.id,models,available:models.length>0,message:models.length?'Models ready. Choose one to start.':'No compatible models are available right now.'},{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  logModelRouteFailure(error instanceof BoundaryError?'boundary':error instanceof ProviderError?'provider':'unexpected',error instanceof BoundaryError?error.status:502);
  const message=error instanceof BoundaryError||error instanceof ProviderError?error.message:'Model discovery could not complete. Check server connectivity and retry.';
  return Response.json({models:[],available:false,message},{status:error instanceof BoundaryError?error.status:502,headers:{'Cache-Control':'no-store'}});
 }
}
