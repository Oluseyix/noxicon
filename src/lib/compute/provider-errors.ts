// Public, fixed error identifiers only. Upstream messages never enter a report.
export const providerErrorCodes=['invalid_credentials','insufficient_credits','provider_rate_limit','model_unavailable','provider_rejected_request','provider_unavailable','network_error','provider_timeout','invalid_provider_response'] as const;
export type ProviderErrorCode=typeof providerErrorCodes[number];
