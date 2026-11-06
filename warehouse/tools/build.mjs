// Bundles the app (and Three.js) into one plain script, twin.bundle.js.
// Browsers refuse to load JavaScript modules from a page opened straight from
// disk (file://), but they do run a plain <script src>. index.html uses this
// bundle when opened from disk, and the normal module files when served.
//
// Run after changing layout.js, assets.js or src/:
//   cd warehouse && npm install && npm run build

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'twin.bundle.js');

export function sourceHash() {
  const h = createHash('sha256');
  for (const f of sourceFiles()) h.update(f + '\0' + readFileSync(join(root, f), 'utf8') + '\0');
  return h.digest('hex').slice(0, 16);
}

export function sourceFiles() {
  return ['layout.js', 'assets.js', ...['calibration', 'controls', 'geometry', 'live', 'main', 'model', 'scene', 'sim', 'ui'].map(n => `src/${n}.js`)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const three = join(root, 'node_modules/three');
  const res = await build({
    entryPoints: [join(root, 'src/main.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    target: 'es2020',
    legalComments: 'none',
    alias: { 'three/addons': join(three, 'examples/jsm'), three: join(three, 'build/three.module.js') },
    logLevel: 'warning',
  });
  const head = `/* Warehouse Twin bundle, built by tools/build.mjs. Do not edit; edit the source and rebuild.\n   source-hash: ${sourceHash()} */\n`;
  writeFileSync(out, head + res.outputFiles[0].text);
  console.log(`wrote twin.bundle.js (${Math.round(res.outputFiles[0].contents.length / 1024)} KB)`);
}
