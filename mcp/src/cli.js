#!/usr/bin/env node
/**
 * Start the VoiceGIS MCP server over stdio.
 *
 * Diagnostics go to stderr: stdout carries the JSON-RPC stream and anything
 * else written there corrupts the session.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createVoiceGisMcpServer, DEFAULT_PERMISSIONS } from './server.js';

const USAGE = `
voicegis-mcp — query a spatial data service in plain language, safely.

Usage:
  voicegis-mcp --service <url> [options]

Options:
  --service <url>       OGC API - Features landing page. Required.
  --allow <perms>       Comma-separated permissions to grant.
                        Default: ${DEFAULT_PERMISSIONS.join(',')}
                        Available: view, query, analysis, export
  --include <ids>       Only expose these collection ids.
  --exclude <ids>       Skip these collection ids.
  --limit <n>           Page size requested from the service. Default 500.
  --max-pages <n>       Safety bound on pagination. Default 20.
  --help                Show this message.

Example:
  voicegis-mcp --service https://demo.ldproxy.net/zoomstack

The agent gets exactly the permissions granted here. Requests naming anything
outside the service's own catalog are refused rather than guessed at.
`;

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

const list = (value) => (typeof value === 'string'
  ? value.split(',').map((part) => part.trim()).filter(Boolean)
  : undefined);

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help || !flags.service) {
    process.stderr.write(USAGE);
    process.exit(flags.help ? 0 : 1);
  }

  const log = (message) => process.stderr.write(`[voicegis-mcp] ${message}\n`);

  const { server, summary } = await createVoiceGisMcpServer({
    serviceUrl: String(flags.service),
    permissions: list(flags.allow) || [...DEFAULT_PERMISSIONS],
    include: list(flags.include),
    exclude: list(flags.exclude),
    limit: flags.limit ? Number(flags.limit) : undefined,
    maxPages: flags['max-pages'] ? Number(flags['max-pages']) : undefined,
    log,
  });

  log(`${summary.layers} layer(s) ready; permissions: ${summary.permissions.join(', ')}`);
  if (!summary.conformance.canFilter) {
    log('this service does not support filtering, so query tools are limited');
  }

  await server.connect(new StdioServerTransport());
  log('listening on stdio');
}

main().catch((error) => {
  process.stderr.write(`[voicegis-mcp] failed to start: ${error.message}\n`);
  process.exit(1);
});
