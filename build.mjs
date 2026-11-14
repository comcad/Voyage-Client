// Single source of truth for building the client bundle.
// Used by:
//   - the Dockerfile  (RUN node build.mjs)  -> bakes the bundle into the image
//   - server.js        (await build())      -> rebuilds on boot (idempotent)
//
// Build.Obfuscate in conf/client.conf controls BOTH minify and obfuscation.

import * as esbuild from 'esbuild';
import pkg from 'javascript-obfuscator';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ConfigMgr, confDir } from './configmgr.mjs';
import { ServerConfigs } from './serverconfigs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JavaScriptObfuscator = pkg.default || pkg;

export const BUNDLE_PATH = path.join(__dirname, 'public', 'Voyage.js');

/**
 * What a bundle is called: the commit it was built from (when this is a git checkout) and when, to the minute (UTC):
 * "578fb85-202611120403". The bundle carries it (src/build.js), the page asks for the script by it so a reload never
 * gets an older one from the browser's cache, and /fps copy prints it.
 */
function buildId() {
  let commit = '';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }
  const at = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return commit ? `${commit}-${at}` : at;
}

/** Builds the bundle; returns its id. */
export async function build(obfuscate = false) {
  console.log(`Building client bundle (Build.Obfuscate = ${obfuscate})...`);
  const id = buildId();

  await esbuild.build({
    entryPoints: [path.join(__dirname, 'src/main.js')],
    bundle: true,
    minify: obfuscate,
    sourcemap: false,
    outfile: BUNDLE_PATH,
    define: { __VOYAGE_BUILD__: JSON.stringify(id) },
  });

  const bundledCode = fs.readFileSync(BUNDLE_PATH, 'utf8');
  console.log(`Bundle built (${(bundledCode.length / 1024).toFixed(2)} KB).`);

  if (obfuscate) {
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
    console.log('Obfuscation skipped (Build.Obfuscate is false).');
  }
  console.log(`Build ${id}.`);
  return id;
}

// Auto-run when invoked directly (node build.mjs) — fails the process on error.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  // `node build.mjs [--conf <dir>]`: Build.Obfuscate from that folder's client.conf, if it has one
  let obfuscate = false;
  try {
    const dir = confDir(process.argv.slice(2));
    if (fs.existsSync(path.join(dir, ConfigMgr.MAIN_FILE))) { ConfigMgr.load(dir); obfuscate = ServerConfigs.OBFUSCATE; }
  } catch (err) {
    console.error('CRITICAL BUILD ERROR:', err.message);
    process.exit(1);
  }
  build(obfuscate).catch((err) => {
    console.error('CRITICAL BUILD ERROR:', err);
    process.exit(1);
  });
}
