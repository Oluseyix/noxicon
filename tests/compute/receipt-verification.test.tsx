// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceiptVerification from '../../src/components/compute/receipt-verification';
import { uiFixture } from './ui-fixture';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each(['verified','mismatch','pending','unavailable'])('shows the server verdict %s for the selected report',async status=>{
 const report=uiFixture();const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({status,message:'Actual verifier result',publisher:'veyra-proof.testnet'})});vi.stubGlobal('fetch',fetch);
 render(<ReceiptVerification report={report}/>);
 const file=new File(['{}'],'receipt.json',{type:'application/json'});Object.defineProperty(file,'text',{value:async()=>'{}'});
 await userEvent.upload(screen.getByLabelText('Upload NEAR receipt'),file);
 await screen.findByText('Actual verifier result');
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({report,receipt:{}});
 expect(fetch.mock.calls[0][0]).toBe('/api/proofs/check');
 expect(screen.queryByText('Publication status not checked here.')).toBeNull();
});
it('rejects malformed receipt JSON without a network request',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);render(<ReceiptVerification report={uiFixture()}/>);
 const file=new File(['bad'],'receipt.json',{type:'application/json'});Object.defineProperty(file,'text',{value:async()=>'bad'});
 await userEvent.upload(screen.getByLabelText('Upload NEAR receipt'),file);
 await screen.findByText(/This file is not valid JSON/);expect(fetch).not.toHaveBeenCalled();
});
