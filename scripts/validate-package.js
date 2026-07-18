import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function fail(message) {
  throw new Error(`Package validation failed: ${message}`);
}

const runtimeDependencies = Object.keys(packageJson.dependencies || {});
if (runtimeDependencies.length > 0) {
  fail(`expected zero runtime dependencies; found ${runtimeDependencies.join(', ')}`);
}

if ((packageJson.files || []).includes('dist')) {
  fail('the package allowlist includes all of dist/ and would ship hosted-site artifacts');
}

for (const [subpath, definition] of Object.entries(packageJson.exports || {})) {
  const targets = typeof definition === 'string'
    ? { default: definition }
    : definition;

  for (const [condition, target] of Object.entries(targets)) {
    if (typeof target !== 'string') continue;
    if (target.includes('/src/')) {
      fail(`${subpath} (${condition}) points to source instead of a built artifact`);
    }
    if (!existsSync(resolve(root, target))) {
      fail(`${subpath} (${condition}) is missing ${target}`);
    }
  }
}

const esm = await import(pathToFileURL(resolve(root, 'dist/core/index.js')).href);
const require = createRequire(import.meta.url);
const cjs = require(resolve(root, 'dist/core/index.cjs'));

for (const [format, api] of [['ESM', esm], ['CommonJS', cjs]]) {
  if (typeof api.createVoiceGISCore !== 'function') {
    fail(`${format} core does not export createVoiceGISCore`);
  }
  if (typeof api.SpatialCommandCompiler !== 'function') {
    fail(`${format} core does not export SpatialCommandCompiler`);
  }
}

const core = esm.createVoiceGISCore();
const plan = await core.compile('zoom in');
if (plan.status !== 'ready' || plan.operations[0]?.type !== esm.OPERATION.VIEW_ZOOM) {
  fail('built core could not compile a basic command');
}

console.log(
  `Package validation passed: ${Object.keys(packageJson.exports).length} exports, ` +
  'ESM + CommonJS + declarations, zero runtime dependencies.'
);
