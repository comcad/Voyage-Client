// Single source of truth for building the client bundle.
// Used by:
//   - the Dockerfile  (RUN node build.mjs)  -> bakes the bundle into the image
//   - server.js        (await build())      -> rebuilds on boot (idempotent)
//
// OBFUSCATE env var (1/true/yes/on) controls BOTH minify and obfuscation.

import * as esbuild from 'esbuild';
import pkg from 'javascript-obfuscator';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JavaScriptObfuscator = pkg.default || pkg;

// One env var controls both minify and obfuscation.
export const OBFUSCATE = /^(1|true|yes|on)$/i.test(process.env.OBFUSCATE || '');

export const BUNDLE_PATH = path.join(__dirname, 'public', 'Voyage.js');

export async function build() {
  console.log(`Building client bundle (OBFUSCATE=${OBFUSCATE})...`);

  await esbuild.build({
    entryPoints: [path.join(__dirname, 'src/main.js')],
    bundle: true,
    minify: OBFUSCATE,
    sourcemap: false,
    outfile: BUNDLE_PATH,
  });

  const bundledCode = fs.readFileSync(BUNDLE_PATH, 'utf8');
  console.log(`Bundle built (${(bundledCode.length / 1024).toFixed(2)} KB).`);

  if (OBFUSCATE) {
    console.log('Running JavaScript obfuscator...');
    const result = JavaScriptObfuscator.obfuscate(bundledCode, {
      compact: true,
      controlFlowFlattening: false,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.75,
      transformObjectKeys: true,
      unicodeEscapeSequence: false,
    });
    fs.writeFileSync(BUNDLE_PATH, result.getObfuscatedCode(), 'utf8');
    console.log('Client bundle generated and heavily obfuscated successfully!');
  } else {
    console.log('Obfuscation skipped (OBFUSCATE is not set).');
  }
}

// Auto-run when invoked directly (node build.mjs) — fails the process on error.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  build().catch((err) => {
    console.error('CRITICAL BUILD ERROR:', err);
    process.exit(1);
  });
}
