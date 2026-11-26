import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const helpersSrc = path.join(root, 'server', 'helpers');
const helpersOut = path.join(distDir, 'helpers');

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(helpersOut, { recursive: true });

await build({
  entryPoints: [path.join(root, 'server', 'cli.ts')],
  outfile: path.join(distDir, 'cli.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
});

await build({
  entryPoints: [path.join(root, 'server', 'index.ts')],
  outfile: path.join(distDir, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
});

// Ensure executable bit on CLI entrypoint
fs.chmodSync(path.join(distDir, 'cli.js'), 0o755);

// Copy zero-dependency Python helper scripts into dist/helpers
for (const file of fs.readdirSync(helpersSrc)) {
  const src = path.join(helpersSrc, file);
  if (!fs.statSync(src).isFile() || file.startsWith('.')) continue;
  const dst = path.join(helpersOut, file);
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);
}

console.log('✓ TamgaVDesktop server & CLI compiled -> dist/cli.js, dist/server.js, dist/helpers/');
