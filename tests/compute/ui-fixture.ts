// Test-only report. Never imported by production code or presented as historical data.
import { configSchema, configurationSnapshot } from '../../src/lib/compute/config';
import { statistics, verificationSummary } from '../../src/lib/compute/metrics';
import { mapVerification } from '../../src/lib/compute/verification';
import type { BenchmarkReport, RequestResult } from '../../src/lib/compute/types';
export function uiFixture():BenchmarkReport {
  const config=configurationSnapshot(configSchema.parse({model:'test/model',measuredRequests:3,warmupRequests:0}));
  const requests:RequestResult[]=[
    {index:0,phase:'measured',promptIndex:0,status:'success',latencyMs:300,ttftMs:100,verificationMs:null,completionId:'test-completion',finishReason:'stop',outputTokens:4,tokenSource:'reported',tokenScope:'provider_completion_including_reasoning',throughputTokensPerSecond:4/.3,outputBytes:11,errorCode:null,verification:mapVerification({status:'unavailable'})},
    {index:1,phase:'measured',promptIndex:1,status:'failed',latencyMs:500,ttftMs:null,verificationMs:null,completionId:null,finishReason:null,outputTokens:null,tokenSource:'unavailable',tokenScope:'unavailable',throughputTokensPerSecond:null,outputBytes:0,errorCode:'request_failed',verification:mapVerification()},
    {index:2,phase:'measured',promptIndex:2,status:'skipped',latencyMs:null,ttftMs:null,verificationMs:null,completionId:null,finishReason:null,outputTokens:null,tokenSource:'unavailable',tokenScope:'unavailable',throughputTokensPerSecond:null,outputBytes:0,errorCode:'not_started',verification:mapVerification()},
  ];
  return {application:'veyra-compute',schemaVersion:1,runId:'11111111-1111-4111-8111-111111111111',origin:'test-fixture',startedAt:'2026-11-11T12:00:00.000Z',completedAt:'2026-11-11T12:00:00.800Z',durationMs:800,status:'cancelled',config,requests,statistics:statistics(requests),verification:verificationSummary(requests)};
}
