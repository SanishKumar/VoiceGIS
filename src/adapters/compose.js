/**
 * Combine several adapters behind one execution contract.
 *
 * A typical application splits responsibilities: a data adapter answers
 * queries while a map adapter moves the view. Composing them keeps each one
 * small and keeps capability reporting accurate, because the executor still
 * sees a single adapter whose capabilities are the union of its parts.
 *
 * @module adapters/compose
 */

/**
 * @param {...import('../core/types.js').VoiceGISAdapter} adapters
 *   Earlier adapters take precedence when more than one supports an operation.
 * @returns {Readonly<import('../core/types.js').VoiceGISAdapter>}
 */
export function composeAdapters(...adapters) {
  const members = adapters.filter(Boolean);
  if (members.length === 0) {
    throw new TypeError('composeAdapters requires at least one adapter.');
  }
  for (const adapter of members) {
    if (typeof adapter.supports !== 'function' || typeof adapter.execute !== 'function') {
      throw new TypeError('Every composed adapter must implement supports() and execute().');
    }
  }

  const capabilities = Object.freeze([
    ...new Set(members.flatMap((adapter) => [...(adapter.capabilities || [])])),
  ]);

  return Object.freeze({
    name: `composed(${members.map((adapter) => adapter.name || 'adapter').join(', ')})`,
    capabilities,
    members: Object.freeze([...members]),

    /** @param {string} type */
    supports(type) {
      return members.some((adapter) => adapter.supports(type));
    },

    /**
     * @param {import('../core/types.js').SpatialOperation} operation
     * @param {import('../core/types.js').ExecutionContext} [context]
     */
    async execute(operation, context) {
      const handler = members.find((adapter) => adapter.supports(operation.type));
      if (!handler) {
        throw new Error(`No composed adapter supports "${operation.type}".`);
      }
      return handler.execute(operation, context);
    },
  });
}
