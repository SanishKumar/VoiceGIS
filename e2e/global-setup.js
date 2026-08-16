import { execSync } from 'node:child_process';

/**
 * Build the demo once, before any server starts.
 *
 * Building inside the `webServer` command races the server that serves the
 * output: if a previous run left a process on the port, the health probe
 * succeeds against the stale server while the build replaces the hashed
 * assets its index.html points at, and every page load 404s its own script.
 */
export default function globalSetup() {
  execSync('npm run build:demo', { stdio: 'inherit' });
}
