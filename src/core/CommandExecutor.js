import { resolveCommandPolicy } from './CommandPolicy.js';
import { CommandPlanValidator } from './CommandPlanValidator.js';

function now(clock) {
  return new Date(clock()).toISOString();
}

function errorDetails(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
  };
}

function supports(adapter, type) {
  if (!adapter) return false;
  if (typeof adapter.supports === 'function') return adapter.supports(type);
  return Array.isArray(adapter.capabilities) && adapter.capabilities.includes(type);
}

/**
 * Executes inspected plans against an explicit application adapter.
 */
export class CommandExecutor {
  /**
   * @param {import('./types.js').ExecutorOptions} [options]
   */
  constructor({ adapter, policy, catalog, strictCatalogVersion, clock } = {}) {
    this.adapter = adapter;
    this.policy = resolveCommandPolicy(policy);
    this.planValidator = catalog
      ? new CommandPlanValidator(catalog, { strictCatalogVersion })
      : null;
    this.clock = clock || Date.now;
  }

  /**
   * @param {import('./types.js').CommandPlan} plan
   * @param {import('./types.js').ExecuteOptions} [options]
   * @returns {Promise<import('./types.js').ExecutionReceipt>}
   */
  async execute(plan, options = {}) {
    const startedAt = now(this.clock);
    /** @type {import('./types.js').ExecutionReceipt} */
    const receipt = {
      planId: plan?.id || null,
      status: 'failed',
      startedAt,
      completedAt: null,
      results: [],
    };
    const emit = (type, detail = {}) => options.onEvent?.({ type, planId: receipt.planId, ...detail });
    /**
     * @param {import('./types.js').ExecutionReceipt['status']} status
     * @returns {import('./types.js').ExecutionReceipt}
     */
    const finish = (status) => {
      receipt.status = status;
      receipt.completedAt = now(this.clock);
      emit('execution.completed', { status, receipt });
      return receipt;
    };

    emit('execution.started', { plan });
    if (!plan || !Array.isArray(plan.operations)) {
      receipt.results.push({ status: 'failed', error: { message: 'A valid compiled plan is required.' } });
      return finish('failed');
    }
    if (plan.operations.length === 0) {
      receipt.results.push({
        status: 'failed',
        error: { message: 'The plan has no executable operations.' },
      });
      return finish('failed');
    }
    if (plan.status === 'needs_input' || plan.status === 'blocked') {
      receipt.results.push({
        status: 'failed',
        error: {
          message: plan.status === 'needs_input'
            ? 'The command needs more input before it can run.'
            : 'The command is blocked.',
          issues: plan.issues || [],
        },
      });
      return finish('failed');
    }
    if (this.planValidator) {
      const validation = this.planValidator.validate(plan);
      if (!validation.valid) {
        receipt.results.push({
          status: 'failed',
          error: {
            name: 'PlanValidationError',
            message: 'The plan failed trusted catalog validation.',
            issues: validation.issues,
          },
        });
        emit('execution.rejected', { issues: validation.issues });
        return finish('failed');
      }
    }
    if (options.signal?.aborted) return finish('cancelled');

    // Preflight everything before performing the first side effect.
    const confirmationOperations = [];
    for (const operation of plan.operations) {
      const decision = this.policy.evaluate(operation);
      if (!decision.allowed) {
        receipt.results.push({
          operationId: operation.id,
          type: operation.type,
          status: 'failed',
          error: { message: decision.reason },
        });
        return finish('failed');
      }
      if (!supports(this.adapter, operation.type)) {
        receipt.results.push({
          operationId: operation.id,
          type: operation.type,
          status: 'failed',
          error: { message: `Adapter does not support "${operation.type}".` },
        });
        return finish('failed');
      }
      if (decision.requiresConfirmation || operation.requiresConfirmation) {
        confirmationOperations.push(operation);
      }
    }

    if (confirmationOperations.length > 0 && options.confirm === undefined) {
      for (const operation of confirmationOperations) {
        receipt.results.push({
          operationId: operation.id,
          type: operation.type,
          status: 'needs_confirmation',
        });
      }
      return finish('needs_confirmation');
    }

    for (const operation of confirmationOperations) {
      if (options.signal?.aborted) return finish('cancelled');
      const accepted = typeof options.confirm === 'function'
        ? await options.confirm(operation, plan)
        : options.confirm === true;
      emit('operation.confirmed', { operation, accepted });
      if (!accepted) {
        receipt.results.push({
          operationId: operation.id,
          type: operation.type,
          status: 'cancelled',
        });
        return finish('cancelled');
      }
    }

    let failed = 0;
    for (const operation of plan.operations) {
      if (options.signal?.aborted) {
        const succeeded = receipt.results.some((result) => result.status === 'succeeded');
        return finish(succeeded || failed ? 'partial' : 'cancelled');
      }
      emit('operation.started', { operation });
      try {
        const value = await this.adapter.execute(operation, {
          plan,
          signal: options.signal,
        });
        /** @type {import('./types.js').OperationResult} */
        const result = {
          operationId: operation.id,
          type: operation.type,
          status: 'succeeded',
          value,
        };
        receipt.results.push(result);
        emit('operation.completed', { operation, result });
      } catch (error) {
        failed += 1;
        /** @type {import('./types.js').OperationResult} */
        const result = {
          operationId: operation.id,
          type: operation.type,
          status: 'failed',
          error: errorDetails(error),
        };
        receipt.results.push(result);
        emit('operation.failed', { operation, result });
        if (options.stopOnError !== false) break;
      }
    }

    if (failed === 0) return finish('succeeded');
    const succeeded = receipt.results.some((result) => result.status === 'succeeded');
    return finish(succeeded ? 'partial' : 'failed');
  }
}
