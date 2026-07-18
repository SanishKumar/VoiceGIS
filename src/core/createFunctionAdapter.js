/**
 * Turn ordinary functions into a VoiceGIS execution adapter.
 *
 * @param {Record<string, import('./types.js').FunctionAdapterHandler>} handlers
 * @param {{ capabilities?: string[], name?: string }} [options]
 * @returns {Readonly<import('./types.js').VoiceGISAdapter>}
 */
export function createFunctionAdapter(handlers = {}, options = {}) {
  const capabilities = new Set(options.capabilities || Object.keys(handlers));

  return Object.freeze({
    name: options.name || 'function-adapter',
    capabilities: Object.freeze([...capabilities]),

    /** @param {string} type */
    supports(type) {
      return capabilities.has(type) && typeof handlers[type] === 'function';
    },

    /**
     * @param {import('./types.js').SpatialOperation} operation
     * @param {import('./types.js').ExecutionContext|Record<string, *>} [context]
     */
    async execute(operation, context = {}) {
      const handler = handlers[operation.type];
      if (!capabilities.has(operation.type) || typeof handler !== 'function') {
        throw new Error(`Adapter does not support "${operation.type}".`);
      }
      return handler({
        operation,
        target: operation.target,
        args: operation.args,
        context,
      });
    },
  });
}
