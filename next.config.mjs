import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.VEYRA_DIST_DIR || '.next',
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
};

// Keep local development separate from production output.
const resolveConfig = (phase) => ({
  ...nextConfig,
  distDir: process.env.VEYRA_DIST_DIR || (phase === 'phase-development-server' ? '.next-browser' : '.next'),
});

export default resolveConfig;
