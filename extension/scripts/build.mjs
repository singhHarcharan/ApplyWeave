import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const outdir = new URL('../dist/', import.meta.url);
await mkdir(outdir, { recursive: true });
await Promise.all([
  build({ entryPoints: [new URL('../src/popup.tsx', import.meta.url).pathname], outfile: new URL('popup.js', outdir).pathname, bundle: true, minify: true, format: 'iife', target: 'chrome120', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'} }),
  build({ entryPoints: [new URL('../src/content.ts', import.meta.url).pathname], outfile: new URL('content.js', outdir).pathname, bundle: true, minify: true, format: 'iife', target: 'chrome120' })
]);
await Promise.all(['manifest.json', 'popup.html'].map(name => copyFile(new URL('../public/' + name, import.meta.url), new URL(name, outdir))));
console.log('Built extension/dist');
