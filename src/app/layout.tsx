import type { ReactNode } from 'react';
import './globals.css';
import './compute.css';
import './rebuild.css';
import '@fontsource-variable/manrope';
export const metadata={title:'Noxicon — Inspect inference evidence. Verify report integrity.'};
export default function Layout({children}:{children:ReactNode}) { return <html lang="en" data-scroll-behavior="smooth"><body>{children}</body></html>; }
