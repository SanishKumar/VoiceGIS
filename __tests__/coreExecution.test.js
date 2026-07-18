import { jest } from '@jest/globals';
import {
  CommandExecutor,
  CommandPolicy,
  OPERATION,
  createFunctionAdapter,
  createVoiceGISCore,
} from '../src/core/index.js';

const fixedClock = () => Date.UTC(2026, 6, 18);

function makePlan(operation, overrides = {}) {
  return {
    version: '1.0',
    id: 'plan_test',
    input: 'test command',
    status: 'ready',
    operations: [{
      id: 'op_test',
      target: null,
      args: {},
      confidence: 1,
      requiresConfirmation: false,
      ...operation,
    }],
    issues: [],
    ...overrides,
  };
}

describe('createFunctionAdapter', () => {
  test('derives capabilities and passes a stable handler payload', async () => {
    const handler = jest.fn(async ({ target, args }) => ({ target, args }));
    const adapter = createFunctionAdapter({ [OPERATION.VIEW_ZOOM]: handler });
    const operation = {
      type: OPERATION.VIEW_ZOOM,
      target: { kind: 'map' },
      args: { delta: 1 },
    };

    expect(adapter.supports(OPERATION.VIEW_ZOOM)).toBe(true);
    await expect(adapter.execute(operation, { userId: 'one' })).resolves.toEqual({
      target: operation.target,
      args: operation.args,
    });
    expect(handler.mock.calls[0][0].context).toEqual({ userId: 'one' });
  });
});

describe('CommandExecutor', () => {
  test('executes supported operations and returns an auditable receipt', async () => {
    const handler = jest.fn(async () => ({ zoom: 8 }));
    const adapter = createFunctionAdapter({ [OPERATION.VIEW_ZOOM]: handler });
    const executor = new CommandExecutor({ adapter, clock: fixedClock });
    const events = [];

    const receipt = await executor.execute(
      makePlan({ type: OPERATION.VIEW_ZOOM, args: { delta: 1 } }),
      { onEvent: (event) => events.push(event.type) }
    );

    expect(receipt).toMatchObject({
      planId: 'plan_test',
      status: 'succeeded',
      startedAt: '2026-07-18T00:00:00.000Z',
      completedAt: '2026-07-18T00:00:00.000Z',
      results: [{
        operationId: 'op_test',
        type: OPERATION.VIEW_ZOOM,
        status: 'succeeded',
        value: { zoom: 8 },
      }],
    });
    expect(events).toEqual([
      'execution.started',
      'operation.started',
      'operation.completed',
      'execution.completed',
    ]);
  });

  test('never performs a confirmation-gated operation without a decision', async () => {
    const handler = jest.fn();
    const adapter = createFunctionAdapter({ [OPERATION.DATA_EXPORT]: handler });
    const policy = new CommandPolicy({
      permissions: ['export'],
      confirm: [OPERATION.DATA_EXPORT],
    });
    const executor = new CommandExecutor({ adapter, policy, clock: fixedClock });
    const plan = makePlan({
      type: OPERATION.DATA_EXPORT,
      requiresConfirmation: true,
    }, { status: 'needs_confirmation' });

    const receipt = await executor.execute(plan);

    expect(receipt.status).toBe('needs_confirmation');
    expect(handler).not.toHaveBeenCalled();
  });

  test('executes accepted confirmations and cancels declined ones', async () => {
    const handler = jest.fn(async () => 'download.geojson');
    const adapter = createFunctionAdapter({ [OPERATION.DATA_EXPORT]: handler });
    const policy = new CommandPolicy({
      permissions: ['export'],
      confirm: [OPERATION.DATA_EXPORT],
    });
    const executor = new CommandExecutor({ adapter, policy, clock: fixedClock });
    const plan = makePlan({
      type: OPERATION.DATA_EXPORT,
      requiresConfirmation: true,
    }, { status: 'needs_confirmation' });

    await expect(executor.execute(plan, { confirm: () => true }))
      .resolves.toMatchObject({ status: 'succeeded' });
    await expect(executor.execute(plan, { confirm: () => false }))
      .resolves.toMatchObject({ status: 'cancelled' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('fails preflight when an adapter capability is missing', async () => {
    const executor = new CommandExecutor({
      adapter: createFunctionAdapter({}),
      clock: fixedClock,
    });
    const receipt = await executor.execute(
      makePlan({ type: OPERATION.VIEW_ZOOM })
    );

    expect(receipt.status).toBe('failed');
    expect(receipt.results[0].error.message).toContain('does not support');
  });

  test('rechecks policy at execution time', async () => {
    const handler = jest.fn();
    const adapter = createFunctionAdapter({ [OPERATION.QUERY_FILTER]: handler });
    const executor = new CommandExecutor({
      adapter,
      policy: new CommandPolicy({ permissions: ['view'] }),
      clock: fixedClock,
    });
    const receipt = await executor.execute(
      makePlan({ type: OPERATION.QUERY_FILTER })
    );

    expect(receipt.status).toBe('failed');
    expect(receipt.results[0].error.message).toContain('Permission "query"');
    expect(handler).not.toHaveBeenCalled();
  });

  test('honors an already-aborted signal', async () => {
    const handler = jest.fn();
    const adapter = createFunctionAdapter({ [OPERATION.VIEW_ZOOM]: handler });
    const executor = new CommandExecutor({ adapter, clock: fixedClock });
    const controller = new AbortController();
    controller.abort();

    const receipt = await executor.execute(
      makePlan({ type: OPERATION.VIEW_ZOOM }),
      { signal: controller.signal }
    );

    expect(receipt.status).toBe('cancelled');
    expect(handler).not.toHaveBeenCalled();
  });

  test('reports partial execution when a signal aborts after a side effect', async () => {
    const controller = new AbortController();
    const handler = jest.fn(async () => {
      controller.abort();
      return 'first operation committed';
    });
    const adapter = createFunctionAdapter({ [OPERATION.VIEW_ZOOM]: handler });
    const executor = new CommandExecutor({ adapter, clock: fixedClock });
    const plan = makePlan(
      { type: OPERATION.VIEW_ZOOM },
      {
        operations: [
          { ...makePlan({ type: OPERATION.VIEW_ZOOM }).operations[0], id: 'op_first' },
          { ...makePlan({ type: OPERATION.VIEW_ZOOM }).operations[0], id: 'op_second' },
        ],
      }
    );

    const receipt = await executor.execute(plan, { signal: controller.signal });

    expect(receipt.status).toBe('partial');
    expect(receipt.results).toHaveLength(1);
    expect(receipt.results[0].status).toBe('succeeded');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('rechecks domain operations with an application-defined policy', async () => {
    const operationType = 'domain.dispatch-crews';
    const policy = {
      evaluate: jest.fn(() => ({
        allowed: true,
        permission: 'admin',
        risk: 'high',
        requiresConfirmation: false,
        reason: null,
      })),
    };
    const handler = jest.fn(async () => 'dispatched');
    const executor = new CommandExecutor({
      adapter: createFunctionAdapter({ [operationType]: handler }),
      policy,
      clock: fixedClock,
    });

    const receipt = await executor.execute(makePlan({ type: operationType }));

    expect(receipt.status).toBe('succeeded');
    expect(policy.evaluate).toHaveBeenCalledWith(expect.objectContaining({ type: operationType }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceGISCore', () => {
  test('compiles and runs against an existing application through one facade', async () => {
    const handler = jest.fn(async ({ args }) => args.predicate);
    const core = createVoiceGISCore({
      clock: fixedClock,
      catalog: {
        layers: [{
          id: 'parcels',
          fields: [{ id: 'status', type: 'string' }],
          capabilities: [OPERATION.QUERY_FILTER],
        }],
      },
      adapter: createFunctionAdapter({ [OPERATION.QUERY_FILTER]: handler }),
    });

    const result = await core.run('filter parcels where status is active');

    expect(result.plan.status).toBe('ready');
    expect(result.receipt.status).toBe('succeeded');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
