import { availableModels } from '../../../../lib/server/near-ai';
import { assertLocalRequest, failure, json } from '../../../../lib/server/ai-http';
export const runtime='nodejs';
export async function GET(request:Request) {
  try {assertLocalRequest(request);return json({models:await availableModels()});}catch(e){return failure(e);}
}
