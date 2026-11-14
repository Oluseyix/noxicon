// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Veyra from '../src/components/veyra';
const csv=readFileSync('public/samples/financial-records.csv','utf8');
beforeEach(()=>{
  vi.stubGlobal('crypto',webcrypto);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:async()=>csv}));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function upload(user:ReturnType<typeof userEvent.setup>,text=csv,name='private-name.csv') {
  const file=new File([text],name,{type:'text/csv'});Object.defineProperty(file,'text',{value:async()=>text});
  await user.upload(screen.getByLabelText('Import CSV'),file);
}
async function choose(user:ReturnType<typeof userEvent.setup>,name='Returning share of all transfers') {
  await user.click(screen.getByRole('button',{name:new RegExp(name)}));
  await waitFor(()=>expect(document.querySelector('.result-number')).not.toBeNull());
}
describe('unified claim workflows (DOM, not visual layout)',()=>{
  it('starts with the fictional claim and no role tabs or automatic data requests',()=>{
    render(<Veyra/>);
    expect(screen.getByRole('heading',{level:1}).textContent).toContain('We processed $1 million in October, mostly from returning customers.');
    expect(screen.queryByRole('button',{name:'Founder'})).toBeNull();expect(screen.queryByRole('button',{name:'Investor'})).toBeNull();
    expect(screen.queryByText(/LOCAL DEMO|PHASE 2|permission simulation/)).toBeNull();
    expect(screen.getByText(/Select a question above/)).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
  });
  it.each([['Returning share of all transfers','42.00%'],['Returning share of customer payments','60.00%'],['October transfer breakdown','$1,000,000.00']])('immediately calculates the preapproved sample question: %s',async(title,result)=>{
    const user=userEvent.setup();render(<Veyra/>);await choose(user,title);
    expect(document.querySelector('.result-number')?.textContent).toBe(result);
    expect((screen.getByRole('button',{name:'Download evidence JSON'}) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(document.querySelectorAll('.hash-row code')).toHaveLength(3);
    expect(screen.getByRole('button',{name:'Inspect all transfers definition'}).textContent).toContain('42.00%');
    expect(screen.getByRole('button',{name:'Inspect customer payments definition'}).textContent).toContain('60.00%');
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledWith('/samples/financial-records.csv');
  });
  it('compares definitions without changing the records or requesting data again',async()=>{
    const user=userEvent.setup();render(<Veyra/>);await choose(user);
    const hash=document.querySelector('.hash-row code')?.textContent;
    await user.click(screen.getByRole('button',{name:'Inspect customer payments definition'}));
    await waitFor(()=>expect(document.querySelector('.result-number')?.textContent).toBe('60.00%'));
    expect(document.querySelector('.hash-row code')?.textContent).toBe(hash);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('imports privately, preserves data on invalid CSV, and approves only the exact selected export',async()=>{
    const user=userEvent.setup();render(<Veyra/>);await upload(user);
    expect(screen.getByRole('heading',{level:1}).textContent).not.toContain('$1 million');
    expect(screen.getByText('Private imported records')).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
    await choose(user);expect(document.querySelector('.result-number')?.textContent).toBe('42.00%');
    expect((screen.getByRole('button',{name:'Download evidence JSON'}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button',{name:'Approve disclosure'}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox',{name:'I approve exporting this exact aggregate disclosure.'}));
    await user.click(screen.getByRole('button',{name:'Approve disclosure'}));
    expect((screen.getByRole('button',{name:'Download evidence JSON'}) as HTMLButtonElement).disabled).toBe(false);
    await choose(user,'Returning share of customer payments');
    expect((screen.getByRole('button',{name:'Download evidence JSON'}) as HTMLButtonElement).disabled).toBe(true);
    await upload(user,'bad');expect((await screen.findByRole('alert')).textContent).toContain('Could not import CSV');
    expect(screen.getByText(/private-name.csv/)).toBeTruthy();expect(document.querySelector('.result-number')?.textContent).toBe('60.00%');expect(fetch).not.toHaveBeenCalled();
  });
  it('clears results and approvals when replacing records and does not infer sample permissions from a filename',async()=>{
    const user=userEvent.setup();render(<Veyra/>);await choose(user);
    await upload(user,csv,'Fictional sample company');
    expect(document.querySelector('.result-number')).toBeNull();expect(screen.getByText('Private imported records')).toBeTruthy();
    await choose(user);expect((screen.getByRole('button',{name:'Download evidence JSON'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('uses changed imported amounts and reports zero denominators without inventing a result',async()=>{
    const user=userEvent.setup();render(<Veyra/>);
    const september=csv.split('\n').filter((line,i)=>i===0||line.includes('2026-09')).join('\n');
    await upload(user,september);await choose(user);
    expect(document.querySelector('.result-number')?.textContent).toBe('Undefined');expect(screen.getByText('Undefined — zero denominator')).toBeTruthy();
  });
  it('recovers from a sample fetch error without blocking import',async()=>{
    vi.mocked(fetch).mockResolvedValueOnce({ok:false} as Response);const user=userEvent.setup();render(<Veyra/>);
    await user.click(screen.getByRole('button',{name:/Returning share of all transfers/}));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load the sample');
    await upload(user);await choose(user);expect(document.querySelector('.result-number')?.textContent).toBe('42.00%');expect(fetch).toHaveBeenCalledTimes(1);
  });
});
