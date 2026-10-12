import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
const outdir = new URL('../dist/', import.meta.url);
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await Promise.all([
  build({ entryPoints: [new URL('../src/panel.tsx', import.meta.url).pathname], outfile: new URL('panel.js', outdir).pathname, bundle: true, minify: true, format: 'iife', target: 'chrome120', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'} }),
  build({ entryPoints: [new URL('../src/content.ts', import.meta.url).pathname], outfile: new URL('content.js', outdir).pathname, bundle: true, minify: true, format: 'iife', target: 'chrome120' }),
  build({ entryPoints: [new URL('../src/background.ts', import.meta.url).pathname], outfile: new URL('background.js', outdir).pathname, bundle: true, minify: true, format: 'iife', target: 'chrome120' })
]);
await Promise.all(['manifest.json', 'panel.html'].map(name => copyFile(new URL('../public/' + name, import.meta.url), new URL(name, outdir))));
console.log('Built extension/dist');
