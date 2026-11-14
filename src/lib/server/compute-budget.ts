import 'server-only';
import { BoundaryError } from './compute-http';
import type { BenchmarkConfig } from '../compute/config';
// Local single-process service only. Public/multi-instance use requires durable quotas and authentication.
export function createRunBudget(now=()=>Date.now()){
 let active=false,windowStart=now(),runs=0,attempts=0,tokens=0;
 return (config:BenchmarkConfig)=>{
  if(active)throw new BoundaryError(409,'A test is already running. Wait for it to finish.');
  if(now()-windowStart>=3600000){windowStart=now();runs=attempts=tokens=0;}
  const count=config.measuredRequests+config.warmupRequests,output=count*config.maxOutputTokens;
  if(runs>=6||attempts+count>40||tokens+output>6000)throw new BoundaryError(429,'The hourly test budget has been reached. Try again later.');
  active=true;runs++;attempts+=count;tokens+=output;
  let released=false;return ()=>{if(!released){released=true;active=false;}};
 };
}
export const reserveRun=createRunBudget();
