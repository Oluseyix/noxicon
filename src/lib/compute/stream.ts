import { z } from 'zod';
const chunkSchema=z.object({
  id:z.string().min(1).max(200),
  choices:z.array(z.object({index:z.number().int().nonnegative(),delta:z.object({content:z.string().nullable().optional()}).passthrough(),finish_reason:z.string().nullable().optional()})),
  usage:z.object({completion_tokens:z.number().int().nonnegative()}).passthrough().nullable().optional(),
}).passthrough();
export class StreamError extends Error {constructor(public code:'invalid_stream'|'empty_output'){super(code);}}
export class StreamCollector {
  completionId:string|null=null;
  ttftMs:number|null=null;
  outputBytes=0;
  reportedTokens:number|null=null;
  // Diagnostic only: never used as visible content or successful-run metrics.
  reportedReasoningTokens:number|null=null;
  finishReason:'stop'|'length'|null=null;
  private lastElapsed=0;
  accept(value:unknown,elapsedMs:number) {
    if(!Number.isFinite(elapsedMs)||elapsedMs<this.lastElapsed)throw new StreamError('invalid_stream');
    this.lastElapsed=elapsedMs;
    const parsed=chunkSchema.safeParse(value);
    if(!parsed.success)throw new StreamError('invalid_stream');
    const chunk=parsed.data;
    if(this.completionId!==null&&this.completionId!==chunk.id)throw new StreamError('invalid_stream');
    this.completionId=chunk.id;
    if(chunk.choices.length>1||chunk.choices.some(c=>c.index!==0))throw new StreamError('invalid_stream');
    const choice=chunk.choices[0];
    if(choice?.delta.content){
      if(this.finishReason!==null)throw new StreamError('invalid_stream');
      if(this.ttftMs===null)this.ttftMs=elapsedMs;
      this.outputBytes+=new TextEncoder().encode(choice.delta.content).byteLength;
      if(this.outputBytes>1048576)throw new StreamError('invalid_stream');
    }
    if(choice?.finish_reason){
      if(this.finishReason!==null||!['stop','length'].includes(choice.finish_reason))throw new StreamError('invalid_stream');
      this.finishReason=choice.finish_reason as 'stop'|'length';
    }
    if(chunk.usage){
      if(this.reportedTokens!==null&&this.reportedTokens!==chunk.usage.completion_tokens)throw new StreamError('invalid_stream');
      this.reportedTokens=chunk.usage.completion_tokens;
      const details=z.object({reasoning_tokens:z.number().int().nonnegative()}).safeParse(chunk.usage.completion_tokens_details);
      if(details.success&&details.data.reasoning_tokens<=this.reportedTokens)this.reportedReasoningTokens=details.data.reasoning_tokens;
    }
  }
  finish() {
    if(!this.finishReason)throw new StreamError('invalid_stream');
    if(this.ttftMs===null)throw new StreamError('empty_output');
  }
}
