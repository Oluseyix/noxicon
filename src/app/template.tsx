'use client';
import { motion } from 'motion/react';
export default function Template({children}:{children:React.ReactNode}){return <motion.div className="vx-page-transition" initial={{opacity:0}} animate={{opacity:1}} transition={{duration:.25}}>{children}</motion.div>}
