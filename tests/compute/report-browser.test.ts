import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { inspectReport, displayMetric } from '../../src/lib/compute/report-browser';
import { reportCommitments } from '../../src/lib/server/compute-report';
import { runBenchmark } from '../../src/lib/server/compute-runner';
import { config, fixture } from './helpers';
import { uiFixture } from './ui-fixture';
describe('local frontend report inspection',()=>{
  it('reads a real engine-generated test report and reproduces the server commitments',async()=>{
    const f=fixture();const report=await runBenchmark(config,f.transport,f.options);
    const inspected=await inspectReport(JSON.stringify(report));
    expect(inspected.report).toEqual(report);expect(inspected.commitments).toEqual(reportCommitments(report));
  });
  it('preserves failed and skipped observations without inventing measurements',async()=>{
    const result=await inspectReport(JSON.stringify(uiFixture()));expect(result.report.statistics.failed).toBe(1);expect(result.report.requests[2].latencyMs).toBeNull();
  });
  it('rejects malformed JSON and oversized files',async()=>{
    await expect(inspectReport('{invalid')).rejects.toThrow('not valid JSON');await expect(inspectReport(' '.repeat(262145))).rejects.toThrow('256 KB');
  });
  it('rejects tampered summaries and extra credentials',async()=>{
    const report=uiFixture();report.statistics.successful=100;
    await expect(inspectReport(JSON.stringify(report))).rejects.toThrow('disagree');
    await expect(inspectReport(JSON.stringify({...uiFixture(),apiKey:'PRIVATE'}))).rejects.toThrow('format');
  });
  it('formats zero separately from unavailable data',()=>{expect(displayMetric(0)).toBe('0');expect(displayMetric(null)).toBe('—');expect(displayMetric(13.33333,'rate')).toBe('13.33');});
});

it('validates the bundled illustrative example against the engine report rules',async()=>{
  const {readFileSync}=await import('node:fs');
  const example=await inspectReport(readFileSync('public/examples/benchmark.json','utf8'));
  expect(example.report.origin).toBe('test-fixture');
  expect(example.report.config.model).toBe('example/illustrative-model');
  expect(example.report.statistics.successful).toBe(1);
  expect(example.report.statistics.failed).toBe(1);
});
