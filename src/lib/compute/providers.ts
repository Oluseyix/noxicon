import { z } from 'zod';

export const cloudProviderSchema=z.enum(['near-ai-cloud','groq']);
export type CloudProviderId=z.infer<typeof cloudProviderSchema>;
export const providerNames:Record<CloudProviderId,string>={'near-ai-cloud':'NEAR AI Cloud',groq:'Groq'};
