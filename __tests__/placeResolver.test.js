import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { OPERATION, PLAN_STATUS } from '../src/core/constants.js';
import { PlaceIndex, createPlaceResolver } from '../src/core/createPlaceResolver.js';
import { createVoiceGISCore } from '../src/core/VoiceGISCore.js';
import { createFunctionAdapter } from '../src/core/createFunctionAdapter.js';

const GAZETTEER = JSON.parse(
  readFileSync(new URL('../demo/data/places.json', import.meta.url), 'utf8')
).places;

const CATALOG = {
  version: 'place-test-1',
  layers: [{
    id: 'earthquakes',
    label: 'Earthquakes',
    aliases: ['quakes'],
    fields: [{ id: 'mag', label: 'Magnitude', aliases: ['magnitude'], type: 'number' }],
    capabilities: [OPERATION.LAYER_VISIBILITY, OPERATION.QUERY_FILTER],
  }],
};

function makeCore(extra = {}) {
  const calls = [];
  const adapter = createFunctionAdapter({
    [OPERATION.VIEW_SET]: ({ args, target }) => {
      calls.push({ type: 'view.set', args, target });
      return args;
    },
    [OPERATION.VIEW_ZOOM]: ({ args }) => {
      calls.push({ type: 'view.zoom', args });
      return args;
    },
    [OPERATION.LAYER_VISIBILITY]: ({ args }) => {
      calls.push({ type: 'layer.visibility', args });
      return args;
    },
    [OPERATION.QUERY_FILTER]: ({ args }) => {
      calls.push({ type: 'query.filter', args });
      return args;
    },
  });

  const gis = createVoiceGISCore({
    catalog: CATALOG,
    adapter,
    policy: { permissions: ['view', 'query'] },
    resolvers: [createPlaceResolver({ places: GAZETTEER })],
    ...extra,
  });
  return { gis, calls };
}

describe('PlaceIndex', () => {
  const index = new PlaceIndex(GAZETTEER);

  test('resolves ids, names, and aliases', () => {
    expect(index.resolve('India').place.id).toBe('india');
    expect(index.resolve('new delhi').place.id).toBe('delhi');
    expect(index.resolve('bombay').place.id).toBe('mumbai');
    expect(index.resolve('USA').place.id).toBe('united-states');
  });

  test('tolerates a leading article and trailing punctuation', () => {
    expect(index.resolve('the Mediterranean').place.id).toBe('mediterranean');
    expect(index.resolve('Delhi.').place.id).toBe('delhi');
  });

  test('resolves near typos but not unrelated words', () => {
    expect(index.resolve('Dehli').place.id).toBe('delhi');
    expect(index.resolve('Tokio').place.id).toBe('tokyo');
    expect(index.resolve('Zorblatt')).toBeNull();
  });

  test('ranks candidates best first', () => {
    const ranked = index.rank('Dehli');
    expect(ranked[0].place.id).toBe('delhi');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  test('rejects malformed place definitions rather than accepting bad geometry', () => {
    expect(() => new PlaceIndex([{ id: 'nowhere' }])).toThrow(/center or bounds/);
    expect(() => new PlaceIndex([{ id: 'x', center: [200, 0] }])).toThrow(/valid coordinate/);
    expect(() => new PlaceIndex([{ id: 'x', bounds: [[10, 0], [5, 20]] }]))
      .toThrow(/south edge/);
    // An antimeridian-crossing extent cannot be expressed as simple bounds.
    expect(() => new PlaceIndex([{ id: 'x', bounds: [[-50, 95], [65, -65]] }]))
      .toThrow(/west edge/);
    expect(() => new PlaceIndex([
      { id: 'dup', center: [0, 0] },
      { id: 'dup', center: [1, 1] },
    ])).toThrow(/Duplicate place id/);
  });
});

describe('place navigation compiles deterministically', () => {
  test('"go to India and zoom in" produces bounds navigation plus a zoom', async () => {
    const { gis, calls } = makeCore();
    const plan = await gis.compile('go to India and zoom in');

    expect(plan.status).toBe(PLAN_STATUS.READY);
    expect(plan.operations.map((op) => op.type)).toEqual([
      OPERATION.VIEW_SET,
      OPERATION.VIEW_ZOOM,
    ]);

    const [navigate] = plan.operations;
    expect(navigate.target).toMatchObject({ kind: 'place', id: 'india', placeKind: 'country' });
    // A country frames its extent instead of dropping a pin in the middle.
    expect(navigate.args.bounds).toEqual([[6.55, 68.11], [35.67, 97.4]]);
    expect(navigate.args.center).toBeUndefined();
    expect(navigate.args.source).toBe('gazetteer');

    const receipt = await gis.execute(plan);
    expect(receipt.status).toBe('succeeded');
    expect(calls.map((call) => call.type)).toEqual(['view.set', 'view.zoom']);
  });

  test('"go to Delhi" produces a centre and zoom', async () => {
    const { gis, calls } = makeCore();
    const plan = await gis.compile('go to Delhi');

    expect(plan.status).toBe(PLAN_STATUS.READY);
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].target).toMatchObject({ kind: 'place', id: 'delhi', placeKind: 'city' });
    expect(plan.operations[0].args).toMatchObject({ center: [28.7041, 77.1025], zoom: 9 });
    expect(plan.operations[0].args.bounds).toBeUndefined();

    const receipt = await gis.execute(plan);
    expect(receipt.status).toBe('succeeded');
    expect(calls[0].args.center).toEqual([28.7041, 77.1025]);
  });

  test('an unknown place returns needs_input with actionable suggestions', async () => {
    const { gis, calls } = makeCore();
    const plan = await gis.compile('go to Atlantis');

    expect(plan.status).toBe(PLAN_STATUS.NEEDS_INPUT);
    expect(plan.operations).toHaveLength(0);

    const issue = plan.issues.find((candidate) => candidate.code === 'unknown_place');
    expect(issue).toBeDefined();
    expect(issue.severity).toBe('input');
    expect(Array.isArray(issue.details.suggestions)).toBe(true);
    expect(issue.details.suggestions.length).toBeGreaterThan(0);
    expect(issue.message).toContain('atlantis');

    const receipt = await gis.execute(plan);
    expect(receipt.status).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  test('a valid navigation combined with an invalid command executes nothing', async () => {
    const { gis, calls } = makeCore();
    const plan = await gis.compile('go to Delhi and show hydrants');

    expect(plan.status).toBe(PLAN_STATUS.NEEDS_INPUT);
    // The navigation was recognized...
    expect(plan.operations.map((op) => op.type)).toContain(OPERATION.VIEW_SET);
    // ...but the plan still carries the unresolved half.
    expect(plan.issues.some((issue) => issue.severity === 'input')).toBe(true);

    // Execution stays atomic: a partially understood request runs nothing.
    const receipt = await gis.execute(plan);
    expect(receipt.status).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  test('never calls a geocoder', async () => {
    const geocode = jest.fn();
    const { gis } = makeCore({ enableGeocoding: false, geocoder: { geocode } });
    await gis.compile('go to India');
    await gis.compile('go to Delhi');
    await gis.compile('go to Atlantis');
    expect(geocode).not.toHaveBeenCalled();
  });

  test('does not hijack catalog commands that merely start with a verb', async () => {
    const { gis } = makeCore();
    const plan = await gis.compile('show earthquakes where magnitude is greater than 5');

    expect(plan.status).toBe(PLAN_STATUS.READY);
    expect(plan.operations.map((op) => op.type)).toEqual([
      OPERATION.LAYER_VISIBILITY,
      OPERATION.QUERY_FILTER,
    ]);
  });

  test('supports alternative navigation phrasings', async () => {
    const { gis } = makeCore();
    for (const text of ['fly to Tokyo', 'navigate to Japan', 'centre on Delhi', 'where is Chile?']) {
      const plan = await gis.compile(text);
      expect(plan.operations[0]?.type).toBe(OPERATION.VIEW_SET);
    }
  });
});
