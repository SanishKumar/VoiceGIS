import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoOutput = resolve(root, 'dist-demo');
const sitesClientOutput = resolve(root, 'dist', 'client');
const sitesServerOutput = resolve(root, 'dist', 'server');

await Promise.all([
  rm(sitesClientOutput, { recursive: true, force: true }),
  rm(sitesServerOutput, { recursive: true, force: true }),
]);

await Promise.all([
  cp(demoOutput, sitesClientOutput, { recursive: true }),
  mkdir(sitesServerOutput, { recursive: true }),
]);

await cp(
  resolve(root, 'sites', 'worker.js'),
  resolve(sitesServerOutput, 'index.js'),
);

console.log('Prepared dist/client and dist/server/index.js for Sites.');
