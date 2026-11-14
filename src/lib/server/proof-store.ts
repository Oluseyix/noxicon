import 'server-only';
import { mkdir, lstat, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { accountSchema, hashSchema, ProofError, receiptSchema, transactionHashSchema } from './proof-format';

const entrySchema=z.object({publisher:accountSchema,runId:z.uuid(),commitment:hashSchema,createdAt:z.number().int().nonnegative(),
 state:z.enum(['reserved','submitted','confirmed','failed','not_submitted']),transactionHash:transactionHashSchema.optional(),receipt:receiptSchema.optional()}).strict();
const journalSchema=z.object({version:z.literal(1),entries:z.array(entrySchema).max(20)}).strict();
export type ProofJournal=z.infer<typeof journalSchema>;
export class ProofStore{
 constructor(readonly directory:string){}
 async locked<T>(work:(journal:ProofJournal,save:()=>Promise<void>)=>Promise<T>):Promise<T>{
  await mkdir(this.directory,{recursive:true,mode:0o700});
  const info=await lstat(this.directory);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw new ProofError('state_permissions','Publication state directory must be a private directory (mode 700).',503);
  const lock=join(this.directory,'publication.lock');
  try{await mkdir(lock,{mode:0o700});}catch{throw new ProofError('publication_locked','Publication is locked. A crashed process requires manual review; locks are never automatically stolen.',409);}
  try{
   const path=join(this.directory,'journal.json');let journal:ProofJournal={version:1,entries:[]};
   try{
    const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536||(stat.mode&0o077)!==0)throw new Error('state');
    journal=journalSchema.parse(JSON.parse(await readFile(path,'utf8')));
   }catch(error){if(!(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'))throw new ProofError('invalid_journal','Publication journal is invalid. Do not delete it or retry signing before manual review.',503);}
   const save=async()=>{
    const temporary=join(this.directory,`journal-${randomUUID()}.tmp`);
    const file=await open(temporary,'wx',0o600);
    try{await file.writeFile(JSON.stringify(journalSchema.parse(journal)));await file.sync();}finally{await file.close();}
    await rename(temporary,path);
    const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}
   };
   return await work(journal,save);
  }finally{await rm(lock,{recursive:true});}
 }
}
