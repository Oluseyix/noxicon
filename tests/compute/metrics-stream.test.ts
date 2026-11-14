import { describe, expect, it } from 'vitest';
import { configSchema, configurationSnapshot, requestBody } from '../../src/lib/compute/config';
import { percentile, tokenUsage } from '../../src/lib/compute/metrics';
import { StreamCollector } from '../../src/lib/compute/stream';
import { mapVerification, type VerificationObservation } from '../../src/lib/compute/verification';
import { chunk } from './helpers';
describe('benchmark configuration and fixed workload',()=>{
  it('uses stable prompts and bounded explicit settings',()=>{
    const config=configSchema.parse({model:'test/model'});
    expect(config).toMatchObject({warmupRequests:1,measuredRequests:5,concurrency:1,maxOutputTokens:96});
    expect(requestBody(config,0).messages).toEqual(requestBody(config,3).messages);
    expect(configurationSnapshot(config)).toMatchObject({stream:true,choices:1,temperature:0,topP:1});
  });
  it.each([{prompt:'secret'},{apiKey:'secret'},{baseUrl:'https://evil.test'},{verification:{verified:true}},{measuredRequests:9},{warmupRequests:3},{concurrency:3},{maxOutputTokens:513},{requestTimeoutMs:999},{measuredRequests:1.5},{model:'bad model'}])('rejects unsafe configuration %j',override=>expect(configSchema.safeParse({model:'test/model',...override}).success).toBe(false));
});
describe('metric definitions',()=>{
  it('uses nearest-rank percentiles, including small samples and empty data',()=>{
    expect(percentile([500,100,400,200,300],50)).toBe(300);
    expect(percentile([500,100,400,200,300],95)).toBe(500);
    expect(percentile([4,8],50)).toBe(4);expect(percentile([8],95)).toBe(8);expect(percentile([],95)).toBeNull();
    expect(percentile(Array.from({length:100},(_,i)=>i+1),95)).toBe(95);
  });
  it('rejects nonfinite/negative metrics and invalid percentiles',()=>{expect(()=>percentile([NaN],50)).toThrow();expect(()=>percentile([-1],50)).toThrow();expect(()=>percentile([1],0)).toThrow();});
  it('uses provider completion count including zero without replacing it with an estimate',()=>{expect(tokenUsage(20,999,2000)).toMatchObject({outputTokens:20,tokenSource:'reported',throughputTokensPerSecond:10});expect(tokenUsage(0,20,1000).outputTokens).toBe(0);});
  it('labels byte-based estimates and avoids division by zero',()=>{expect(tokenUsage(null,9,1000)).toMatchObject({outputTokens:3,tokenSource:'estimated',tokenScope:'visible_text_utf8_bytes_div_4',throughputTokensPerSecond:3});expect(tokenUsage(1,4,0).throughputTokensPerSecond).toBeNull();expect(()=>tokenUsage(-1,4,1000)).toThrow();});
});
describe('streaming events (not token counting by chunks)',()=>{
  it('ignores role, empty, reasoning and tool events before first content',()=>{
    const s=new StreamCollector();s.accept(chunk(null,null,{choices:[{index:0,delta:{role:'assistant',reasoning_content:'thinking',tool_calls:[]}}]}),10);s.accept(chunk(''),20);expect(s.ttftMs).toBeNull();
    s.accept(chunk('two words'),30);s.accept(chunk(null,'stop'),40);s.accept({id:'completion-test',choices:[],usage:{completion_tokens:7}},50);s.finish();
    expect(s.ttftMs).toBe(30);expect(s.reportedTokens).toBe(7);expect(s.outputBytes).toBe(9);
  });
  it('treats whitespace as generated content and measures UTF-8 bytes',()=>{const s=new StreamCollector();s.accept(chunk(' '),0);s.accept(chunk('é'),10);s.accept(chunk(null,'length'),20);s.finish();expect(s.ttftMs).toBe(0);expect(s.outputBytes).toBe(3);expect(s.finishReason).toBe('length');});
  it('requires visible output and a finish marker',()=>{const s=new StreamCollector();s.accept(chunk('text'),1);expect(()=>s.finish()).toThrow('invalid_stream');const empty=new StreamCollector();empty.accept(chunk(null,'stop'),1);expect(()=>empty.finish()).toThrow('empty_output');});
  it.each([{id:'other',choices:[]},{id:'completion-test',choices:[{index:1,delta:{content:'x'}}]},{id:'completion-test',choices:[],usage:{completion_tokens:-1}},chunk(null,'tool_calls')])('rejects malformed, mismatched and unsupported stream events',bad=>{const s=new StreamCollector();s.accept(chunk('hello'),1);expect(()=>s.accept(bad,2)).toThrow('invalid_stream');});
  it('rejects post-finish content, decreasing clocks and conflicting usage',()=>{
    const s=new StreamCollector();s.accept(chunk('a','stop'),2);expect(()=>s.accept(chunk('b'),3)).toThrow();expect(()=>s.accept({id:'completion-test',choices:[]},1)).toThrow();
    s.accept({id:'completion-test',choices:[],usage:{completion_tokens:1}},4);expect(()=>s.accept({id:'completion-test',choices:[],usage:{completion_tokens:2}},5)).toThrow();
  });
});
describe('verification mapping does not invent evidence',()=>{
  it('distinguishes gateway signatures even if contradictory model flags are supplied',()=>expect(mapVerification({status:'verified',signatureKind:'gateway',modelAttestationVerified:true,gpuEvidenceVerified:true})).toMatchObject({status:'gateway',modelTeeVerified:false,gpuTeeVerified:false}));
  it('requires model evidence for provider TEE and GPU evidence for GPU claims',()=>{
    expect(mapVerification({status:'verified',signatureKind:'provider_tee',modelAttestationVerified:false,gpuEvidenceVerified:true}).status).toBe('failed');
    expect(mapVerification({status:'verified',signatureKind:'provider_tee',modelAttestationVerified:true,gpuEvidenceVerified:false})).toMatchObject({modelTeeVerified:true,gpuTeeVerified:false});
  });
  it('fails closed on malformed adapter observations',()=>{expect(mapVerification({status:'verified',signatureKind:'unknown',modelAttestationVerified:true,gpuEvidenceVerified:true} as unknown as VerificationObservation).status).toBe('failed');});
  it('preserves failed, unavailable and not-requested states',()=>{expect(mapVerification({status:'failed'}).status).toBe('failed');expect(mapVerification({status:'unavailable'}).status).toBe('unavailable');expect(mapVerification().status).toBe('not_requested');});
});

// Diagnostic usage never substitutes for visible answer content.
describe('reasoning usage diagnostics',()=>{
 it.each(['length','stop'] as const)('keeps numeric reasoning usage for an empty %s stream',finish=>{
  const s=new StreamCollector();
  s.accept(chunk(null,null,{choices:[{index:0,delta:{reasoning:'not answer content'}}]}),10);
  s.accept(chunk(null,finish,{usage:{completion_tokens:96,completion_tokens_details:{reasoning_tokens:96}}}),20);
  expect(()=>s.finish()).toThrow('empty_output');expect(s.reportedReasoningTokens).toBe(96);
  expect(s.reportedTokens).toBe(96);expect(s.ttftMs).toBeNull();expect(s.outputBytes).toBe(0);
 });
 it('does not trust malformed optional reasoning counts or weaken completion validation',()=>{
  const s=new StreamCollector();s.accept(chunk(null,'length',{usage:{completion_tokens:96,completion_tokens_details:{reasoning_tokens:100}}}),20);
  expect(s.reportedReasoningTokens).toBeNull();expect(()=>s.finish()).toThrow('empty_output');
  const malformed=new StreamCollector();malformed.accept(chunk(null,null,{usage:{completion_tokens:96}}),20);
  expect(()=>malformed.finish()).toThrow('invalid_stream');
 });
});
