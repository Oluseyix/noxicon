/** GPT-OSS spends its completion budget on reasoning as well as visible output. */
export function recommendedOutputTokens(model:{id:string;maxOutputTokens:number},mode='quick'){
 const requested=/^openai\/gpt-oss-/i.test(model.id)?512:mode==='detailed'?128:96;
 return Math.min(requested,model.maxOutputTokens);
}
