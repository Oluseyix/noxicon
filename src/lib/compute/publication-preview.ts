import { canonicalJson,validateReport } from './report';
// Independent browser reproduction of the existing v1 publication format.
// Never use the separate local report fingerprints as a publication digest.
export async function publicationPreview(value:unknown){
 const report=validateReport(value);
 const {verification,requests,...immutable}=report;void verification;
 const evidence={...immutable,requests:requests.map(request=>{
  const {verification,verificationMs,...observation}=request;void verification;void verificationMs;return observation;
 })};
 const canonical=canonicalJson({format:'veyra-benchmark-evidence',version:1,algorithm:'sha256',evidence});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
 return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
