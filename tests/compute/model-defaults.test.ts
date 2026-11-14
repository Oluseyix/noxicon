import { describe, expect, it } from 'vitest';
import { recommendedOutputTokens } from '../../src/lib/compute/model-defaults';
describe('launcher output budgets',()=>{
 it('reserves reasoning space for GPT-OSS in both presets',()=>{
  for(const mode of ['quick','detailed'])expect(recommendedOutputTokens({id:'openai/gpt-oss-120b',maxOutputTokens:512},mode)).toBe(512);
 });
 it('respects provider capacity',()=>{expect(recommendedOutputTokens({id:'openai/gpt-oss-20b',maxOutputTokens:256})).toBe(256);});
 it('keeps lightweight budgets for other models',()=>{
  expect(recommendedOutputTokens({id:'llama-3.3-70b-versatile',maxOutputTokens:512})).toBe(96);
  expect(recommendedOutputTokens({id:'llama-3.3-70b-versatile',maxOutputTokens:512},'detailed')).toBe(128);
 });
});
