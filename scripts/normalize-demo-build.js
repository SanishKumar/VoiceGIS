import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'dist-demo', 'index.html');
const html = await readFile(outputPath, 'utf8');

await writeFile(outputPath, html.replace(/\r+\n/g, '\n'), 'utf8');
