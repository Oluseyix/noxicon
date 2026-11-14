import 'server-only';
import { selectedProvider } from './compute-env';
import { createNearCloudAdapter } from './compute-near';
import { createGroqAdapter } from './compute-groq';
import type { ComputeProvider } from './compute-cloud';
import { providerNames } from '../compute/providers';

// Selection happens at the server boundary; browsers cannot submit providers,
// credentials or endpoints. One provider instance is pinned for each run.
export function computeProvider(){
 const id=selectedProvider();
 const adapter:ComputeProvider=id==='groq'?createGroqAdapter():createNearCloudAdapter();
 return {id,name:providerNames[id],...adapter};
}
