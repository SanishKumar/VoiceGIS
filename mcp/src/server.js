/**
 * An MCP server that lets an agent query a spatial data service safely.
 *
 * The agent sends a request in plain language. VoiceGIS compiles it against a
 * catalog derived from the service itself, checks it against a policy the
 * operator set, and only then executes it. The agent never writes a query
 * string, so it cannot name a field, a layer, or a permission that does not
 * exist — and every attempt comes back with a typed plan and a receipt.
 *
 * @module voicegis-mcp/server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CommandPolicy,
  OPERATION,
  PLAN_STATUS,
  createVoiceGISCore,
} from 'voicegis/core';
import {
  catalogFromOgcService,
  createOgcApiFeaturesAdapter,
} from 'voicegis/adapters';

/** Read-only unless the operator says otherwise. */
export const DEFAULT_PERMISSIONS = Object.freeze(['view', 'query']);

const MAX_FEATURES_RETURNED = 50;

function textResult(payload, { isError = false } = {}) {
  return {
    isError,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/** Trim a feature to something an agent can read without burning its context. */
function summarizeFeature(feature) {
  return {
    id: feature.id ?? null,
    properties: feature.properties ?? {},
    geometryType: feature.geometry?.type ?? null,
  };
}

/**
 * Describe an operation without leaking adapter internals.
 */
function summarizeOperation(operation) {
  return {
    id: operation.id,
    type: operation.type,
    target: operation.target,
    args: operation.args,
    permission: operation.permission,
    risk: operation.risk,
    requiresConfirmation: operation.requiresConfirmation,
  };
}

/**
 * Build the server around a live service.
 *
 * @param {object} options
 * @param {string} options.serviceUrl - OGC API - Features landing page.
 * @param {string[]} [options.permissions] - Defaults to view and query.
 * @param {string[]} [options.include] - Restrict to these collection ids.
 * @param {string[]} [options.exclude]
 * @param {number} [options.maxPages]
 * @param {number} [options.limit]
 * @param {typeof fetch} [options.fetch]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{ server: McpServer, summary: object }>}
 */
export async function createVoiceGisMcpServer(options) {
  const {
    serviceUrl,
    permissions = DEFAULT_PERMISSIONS,
    include,
    exclude,
    maxPages = 20,
    limit = 500,
    fetch: fetchImpl,
    log = () => {},
  } = options;

  if (!serviceUrl) throw new TypeError('A serviceUrl is required.');

  log(`Reading ${serviceUrl}…`);
  const derived = await catalogFromOgcService(serviceUrl, {
    fetch: fetchImpl,
    include,
    exclude,
  });
  for (const warning of derived.warnings) log(`warning: ${warning}`);

  const adapter = createOgcApiFeaturesAdapter({
    baseUrl: serviceUrl,
    catalog: derived.catalog,
    geometryProperty: derived.geometryProperty,
    fetch: fetchImpl,
    maxPages,
    limit,
  });

  // The operator decides what the agent may do. Confirmation-gated operations
  // have no operator present in an MCP session, so nothing is gated: anything
  // that would need a human is simply not permitted unless granted here.
  const policy = new CommandPolicy({ permissions: [...permissions], confirm: [] });

  const gis = createVoiceGISCore({
    catalog: derived.catalog,
    adapter,
    policy,
  });

  const summary = {
    service: serviceUrl,
    layers: derived.catalog.layers.length,
    catalogVersion: derived.catalog.version,
    permissions: [...permissions],
    conformance: derived.conformance,
    warnings: derived.warnings,
  };

  const server = new McpServer(
    { name: 'voicegis', version: '0.1.0' },
    {
      instructions:
        'Query a spatial data service in plain language. Call describe_data first: it '
        + 'lists the only layers, fields and operations that exist. Requests naming '
        + 'anything else are refused rather than guessed at. Use preview_command to see '
        + 'the compiled plan without running it, and run_command to execute.',
    }
  );

  /* ------------------------------------------------------------------ *
   * describe_data — the grounding tool
   * ------------------------------------------------------------------ */

  server.registerTool('describe_data', {
    title: 'Describe the available spatial data',
    description:
      'List the layers, fields and operations this service actually supports, plus the '
      + 'permissions granted to this session. Call this before composing a request: '
      + 'these are the only names that can be used.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => textResult({
    service: serviceUrl,
    catalogVersion: derived.catalog.version,
    permissionsGranted: [...permissions],
    layers: derived.catalog.layers.map((layer) => ({
      id: layer.id,
      label: layer.label,
      alsoKnownAs: layer.aliases ?? [],
      fields: layer.fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type ?? 'unknown',
        unit: field.unit,
      })),
      operations: layer.capabilities,
    })),
    serviceLimitations: derived.warnings,
    examples: [
      'show airports where name contains international',
      'count railway stations',
      'select airports within 50 kilometers of railway_stations',
    ],
  }));

  /* ------------------------------------------------------------------ *
   * preview_command — compile without touching anything
   * ------------------------------------------------------------------ */

  server.registerTool('preview_command', {
    title: 'Compile a request without running it',
    description:
      'Turn a plain-language request into a typed plan and return it unexecuted. Use this '
      + 'to check what a request would do, or to see why one was refused.',
    inputSchema: {
      request: z.string().min(1).describe('The request in plain language.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ request }) => {
    const plan = await gis.compile(request);
    return textResult({
      status: plan.status,
      wouldExecute: plan.status === PLAN_STATUS.READY,
      operations: plan.operations.map(summarizeOperation),
      issues: plan.issues,
    });
  });

  /* ------------------------------------------------------------------ *
   * run_command — compile, check, execute, receipt
   * ------------------------------------------------------------------ */

  server.registerTool('run_command', {
    title: 'Run a spatial request',
    description:
      'Compile a plain-language request, check it against the catalog and the granted '
      + 'permissions, then execute it. Returns the typed plan and a per-operation receipt. '
      + 'A request that names something outside the catalog, or needs a permission that '
      + 'was not granted, is refused and nothing runs.',
    inputSchema: {
      request: z.string().min(1).describe('The request in plain language.'),
      includeFeatures: z.boolean().optional()
        .describe(`Return up to ${MAX_FEATURES_RETURNED} matching features.`),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ request, includeFeatures }) => {
    const plan = await gis.compile(request);

    if (plan.status !== PLAN_STATUS.READY) {
      // Nothing ran. Hand back the reason and the recognised half so the
      // agent can correct itself rather than retrying blind.
      return textResult({
        status: plan.status,
        executed: false,
        reason: plan.status === PLAN_STATUS.BLOCKED
          ? 'The policy for this session does not permit part of this request.'
          : 'Part of this request could not be resolved against the catalog.',
        recognizedButNotRun: plan.operations.map(summarizeOperation),
        issues: plan.issues,
        hint: 'Call describe_data for the layers, fields and operations that exist.',
      }, { isError: false });
    }

    const receipt = await gis.execute(plan);

    /** @type {Record<string, object[]>} */
    const features = {};
    if (includeFeatures) {
      for (const layer of derived.catalog.layers) {
        const selected = adapter.getFeatures(layer.id, { scope: 'selected' });
        const matched = selected.length > 0 ? selected : adapter.getFeatures(layer.id);
        if (matched.length > 0) {
          features[layer.id] = matched.slice(0, MAX_FEATURES_RETURNED).map(summarizeFeature);
        }
      }
    }

    const state = adapter.getState();
    const incomplete = Object.entries(state.layers)
      .filter(([, entry]) => entry.complete === false)
      .map(([layerId]) => layerId);

    return textResult({
      status: receipt.status,
      executed: true,
      operations: plan.operations.map(summarizeOperation),
      results: receipt.results.map((result) => ({
        operationId: result.operationId,
        type: result.type,
        status: result.status,
        value: result.value,
        error: result.error?.message,
      })),
      ...(incomplete.length > 0 ? {
        warning: `Results for ${incomplete.join(', ')} are incomplete: the service returned `
          + 'more than the page bound allows. Narrow the request for an exact answer.',
      } : {}),
      ...(includeFeatures ? { features } : {}),
    });
  });

  /* ------------------------------------------------------------------ *
   * A resource, so a client can show the catalog without a tool call
   * ------------------------------------------------------------------ */

  server.registerResource('catalog', 'voicegis://catalog', {
    title: 'Spatial catalog',
    description: 'The layers and fields derived from the service.',
    mimeType: 'application/json',
  }, async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify({ ...derived.catalog, conformance: derived.conformance }, null, 2),
    }],
  }));

  return { server, summary, gis, adapter, derived };
}

export { OPERATION, PLAN_STATUS };
