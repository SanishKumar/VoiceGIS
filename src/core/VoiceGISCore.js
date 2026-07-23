import { SpatialCatalog } from './SpatialCatalog.js';
import { resolveCommandPolicy } from './CommandPolicy.js';
import { SpatialCommandCompiler } from './SpatialCommandCompiler.js';
import { CommandExecutor } from './CommandExecutor.js';

/**
 * Headless facade for compiling and executing GIS commands.
 */
export class VoiceGISCore {
  /** @param {import('./types.js').VoiceGISCoreOptions} [options] */
  constructor(options = {}) {
    this.catalog = options.catalog instanceof SpatialCatalog
      ? options.catalog
      : new SpatialCatalog(options.catalog);
    this.policy = resolveCommandPolicy(options.policy);
    this.adapter = options.adapter || null;
    this.compiler = new SpatialCommandCompiler({
      ...options,
      catalog: this.catalog,
      policy: this.policy,
    });
    this.executor = new CommandExecutor({
      adapter: this.adapter,
      policy: this.policy,
      catalog: this.catalog,
      strictCatalogVersion: options.strictCatalogVersion,
      clock: options.clock,
    });
  }

  /** @param {string} input */
  compile(input) {
    return this.compiler.compile(input);
  }

  /**
   * @param {import('./types.js').CommandPlan} plan
   * @param {import('./types.js').ExecuteOptions} [options]
   */
  execute(plan, options) {
    return this.executor.execute(plan, options);
  }

  /**
   * @param {string} input
   * @param {import('./types.js').ExecuteOptions} [options]
   */
  async run(input, options) {
    const plan = await this.compile(input);
    const receipt = await this.execute(plan, options);
    return { plan, receipt };
  }

  /** @param {import('./types.js').CommandResolver} resolver */
  addResolver(resolver) {
    return this.compiler.addResolver(resolver);
  }
}

/** @param {import('./types.js').VoiceGISCoreOptions} [options] */
export function createVoiceGISCore(options = {}) {
  return new VoiceGISCore(options);
}
