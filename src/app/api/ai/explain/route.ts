// The previous financial explanation endpoint is retired, not connected to Compute.
export async function POST() {
  return Response.json({error:{code:'RETIRED',message:'The financial explanation endpoint has been retired.'}},{status:410,headers:{'Cache-Control':'no-store'}});
}
