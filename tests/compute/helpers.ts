import type { BenchmarkTransport } from '../../src/lib/compute/types';
export const id='11111111-1111-4111-8111-111111111111';
export const chunk=(content:string|null,finish:string|null=null,extra:Record<string,unknown>={})=>({id:'completion-test',choices:[{index:0,delta:{content},finish_reason:finish}],...extra});
export function fixture() {
  let time=0;
  const options={now:()=>time,wallTime:()=>new Date('2026-11-11T12:00:00.000Z'),runId:()=>id};
  const transport:BenchmarkTransport={origin:'test-fixture',capabilities:{model:'test/model',streaming:true,maxOutputTokens:256},
    async open(){return (async function*(){time+=50;yield chunk(null,null,{choices:[{index:0,delta:{role:'assistant'}}]});time+=50;yield chunk('Hello');time+=100;yield chunk(' world');time+=50;yield chunk(null,'stop');time+=50;yield {id:'completion-test',choices:[],usage:{completion_tokens:4}};})();}};
  return {transport,options};
}
export const config={model:'test/model',warmupRequests:0,measuredRequests:1};
