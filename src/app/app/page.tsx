import Link from 'next/link';
import Workspace from '../../components/compute/workspace';
import './launcher.css';
import './report.css';
export const metadata={title:'Workspace — Noxicon'};
export default function ComputeApp(){return <div className="vc-app vn-app"><a className="vc-skip" href="#main">Skip to content</a><header className="vn-nav"><Link className="vn-brand" href="/" aria-label="Noxicon home">noxicon<span>.</span></Link><span className="vn-app-label">Compute</span><Link href="/">Home</Link></header><main id="main" tabIndex={-1}><Workspace/></main><footer className="vn-footer"><span>Measure compute. Verify evidence.</span><Link href="/">noxicon.</Link></footer></div>}
