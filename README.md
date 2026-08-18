<div align="center">
  <h1>VoiceGIS</h1>
  <p><strong>The control plane between natural-language requests and real GIS applications.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/voicegis"><img src="https://img.shields.io/npm/v/voicegis" alt="npm version"></a>
    <a href="https://voicemap-three.vercel.app/"><img src="https://img.shields.io/badge/live-demo-ff6b35" alt="Live demo"></a>
    <a href="https://github.com/SanishKumar/VoiceGIS/actions"><img src="https://img.shields.io/github/actions/workflow/status/SanishKumar/VoiceGIS/ci.yml?label=tests" alt="Test status"></a>
    <img src="https://img.shields.io/badge/runtime_dependencies-0-1f8a70" alt="Zero runtime dependencies">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license">
  </p>
</div>

<div align="center">
  <a href="https://voicemap-three.vercel.app/">
    <img src="docs/media/demo.gif" alt="Filtering, navigating and blocking a command in the VoiceGIS demo" width="800">
  </a>
  <p><em>Live USGS earthquake data. A request is compiled, grounded against the catalog, checked against the policy, and only then executed — <a href="https://voicemap-three.vercel.app/">try it</a>.</em></p>
</div>

VoiceGIS Core turns typed or spoken GIS requests into deterministic, inspectable operations that an existing application can safely execute.

Speech libraries give developers transcripts. Mapping SDKs give them low-level APIs. The difficult application work sits between those layers: resolving a user's words against real layers and fields, building typed filters, checking permissions, requesting confirmation for risky work, verifying adapter capabilities, and recording what actually ran. That is the problem VoiceGIS Core solves.

```text
transcript or text
        ↓
catalog-grounded command compiler
        ↓
typed plan → policy → confirmation
        ↓
your adapter → your existing map/data stack
        ↓
execution receipt
```

VoiceGIS does not generate SQL, take ownership of your map, or require a particular speech provider.

## Why this is useful

- **Typed spatial plans:** `"area is greater than 2 hectares"` becomes a comparison AST, not an unsafe SQL string.
- **Grounded commands:** layer names, aliases, fields, and supported actions come from your application catalog.
- **Execution-bound validation:** stale or tampered plans are rejected against the trusted catalog before an adapter sees them.
- **Safe execution:** view, query, edit, analysis, export, location, and admin permissions are evaluated before an adapter runs.
- **Human checkpoints:** exports, edits, analysis, and other configured operations can require explicit confirmation.
- **Capability contracts:** unsupported commands fail during preflight instead of halfway through a workflow.
- **Auditable results:** every run returns a per-operation receipt and can emit lifecycle events.
- **No hidden network calls:** Core's geocoding is disabled unless the application explicitly enables and supplies it, and navigation resolves against a gazetteer you own.
- **Zero runtime dependencies:** the headless core works in browsers, Node.js services, workers, React, Vue, and other JavaScript environments.

## Install

```bash
npm install voicegis
```

The headless `voicegis/core` entry point needs no map or AI dependency. Leaflet, OpenLayers, Transformers.js, and TensorFlow integrations are optional peers and are installed only when an application chooses those legacy modules.

## Quick start

The smallest useful integration describes the application's spatial vocabulary and connects operations to existing functions:

```js
import {
  OPERATION,
  createFunctionAdapter,
  createVoiceGISCore,
} from 'voicegis/core';

const adapter = createFunctionAdapter({
  [OPERATION.LAYER_VISIBILITY]: ({ target, args }) => {
    return mapLayers.setVisible(target.layerId, args.visible);
  },
  [OPERATION.QUERY_FILTER]: ({ target, args }) => {
    return featureStore.applyPredicate(target.layerId, args.predicate);
  },
});

const gis = createVoiceGISCore({
  catalog: {
    version: 'city-2026.07',
    layers: [{
      id: 'parcels',
      label: 'Land parcels',
      aliases: ['plots'],
      fields: [
        {
          id: 'area_ha',
          label: 'Area',
          aliases: ['size'],
          type: 'number',
          unit: 'hectare',
        },
        {
          id: 'zoning',
          label: 'Zoning',
          type: 'string',
        },
      ],
      capabilities: [
        OPERATION.LAYER_VISIBILITY,
        OPERATION.QUERY_FILTER,
      ],
    }],
  },
  adapter,
});

const plan = await gis.compile(
  'show plots where area is greater than 2 hectares'
);

console.log(plan.status); // "ready"
console.log(plan.operations[1].args.predicate);
// {
//   type: "comparison",
//   field: "area_ha",
//   operator: "gt",
//   value: 2,
//   unit: "hectare"
// }

const receipt = await gis.execute(plan);
console.log(receipt.status); // "succeeded"
```

The same compiler accepts input from a text box, Web Speech, Whisper, a React speech hook, a call-center transcript, or an LLM. Transcription is an input concern, not a hard dependency of the command layer.

## Compile, inspect, execute

VoiceGIS deliberately separates understanding from side effects:

```js
const plan = await gis.compile(
  'buffer selected features by 250 meters and export selected features as geojson'
);

if (plan.status === 'needs_input') {
  showClarification(plan.issues);
} else if (plan.status === 'blocked') {
  showPolicyExplanation(plan.issues);
} else {
  const receipt = await gis.execute(plan, {
    confirm: async (operation) => {
      return showConfirmationDialog(operation);
    },
    onEvent: (event) => auditLog.write(event),
  });
}
```

Safe defaults grant only `view` and `query`. Analysis and export must be explicitly authorized:

```js
import { CommandPolicy, OPERATION } from 'voicegis/core';

const policy = new CommandPolicy({
  permissions: ['view', 'query', 'analysis', 'export'],
  confirm: [
    OPERATION.ANALYSIS_BUFFER,
    OPERATION.DATA_EXPORT,
  ],
});
```

Policy is checked while compiling and checked again immediately before execution.

Catalog grounding is also checked again immediately before execution. `VoiceGISCore`
rejects changed layer ids, unknown predicate fields, missing layer capabilities,
unsupported plan schemas, and plans compiled against a stale catalog version before
the first adapter side effect.

For an explicit server-side check, use the exported validator:

```js
import { validateCommandPlan } from 'voicegis/core';

const validation = validateCommandPlan(clientPlan, serverCatalog);
if (!validation.valid) {
  return Response.json({ issues: validation.issues }, { status: 400 });
}
```

## Real workflows

| Context | Request | Compiled operation |
|---|---|---|
| Municipal planning | “Show parcels where area is greater than 2 hectares” | Visibility plus typed attribute filter |
| Emergency response | “Select incidents within 5 km of hospitals” | Spatial selection with normalized distance and layer reference |
| Field survey | “Buffer selected features by 250 meters, then export as GeoJSON” | Confirmation-gated analysis and export chain |
| Asset operations | “Count hydrants where inspection status is overdue” | Catalog-grounded filtered count |
| Public dashboard | “Clear filters on road closures” | Scoped query reset |

Commands currently cover map navigation, layer visibility, attribute filtering, selection, spatial selection, counts, buffer requests, exports, history, and adapter switching. Applications can add domain language through custom resolvers without forking the compiler.

```js
gis.addResolver(({ text }) => {
  if (text !== 'focus the evacuation zone') return null;
  return {
    type: OPERATION.VIEW_SET,
    args: { bounds: emergencyState.evacuationBounds },
  };
});
```

## Plan contract

Every compile result is serializable:

```js
{
  version: '1.0',
  id: 'plan_...',
  input: 'select incidents within 5 km of hospitals',
  status: 'ready',
  operations: [{
    id: 'op_...',
    type: 'query.spatial_select',
    target: { kind: 'layer', layerId: 'incidents' },
    args: {
      relation: 'within',
      distance: { value: 5, unit: 'kilometer' },
      reference: { kind: 'layer', layerId: 'hospitals' },
    },
    confidence: 1,
    risk: 'medium',
    permission: 'query',
    requiresConfirmation: false,
  }],
  issues: [],
  requirements: {
    capabilities: ['query.spatial_select'],
    permissions: ['query'],
    confirmationOperationIds: [],
  },
}
```

Adapters receive the plan's typed objects and decide how to translate them to ArcGIS query parameters, Mapbox expressions, OpenLayers filters, PostGIS service requests, local GeoJSON operations, or another application API. VoiceGIS intentionally does not hide those application-specific choices.

## Adapters you can use today

`voicegis/adapters` ships working implementations so a compiled plan does real work before you write an integration.

**GeoJSON** — executes filters, selections, geodesic proximity queries, counts, buffers, and exports against in-memory feature collections. It owns query state and emits a snapshot after every mutation; it never touches your map.

```js
import { createGeoJSONAdapter } from 'voicegis/adapters';

const adapter = createGeoJSONAdapter({
  layers: { parcels, hydrants },
  catalog,
  onChange: (state) => render(state),
});
```

**OGC API - Features** — translates the predicate AST to CQL2-Text and sends it as the standard `filter` parameter:

```js
const adapter = createOgcApiFeaturesAdapter({
  baseUrl: 'https://example.org/ogc',
  collections: { incidents: 'emergency_incidents' },
  catalog,
});

// { field: 'mag', operator: 'gt', value: 5 }
//   → GET /collections/quakes/items?filter=mag%20%3E%205&filter-lang=cql2-text
```

Both refuse rather than guess: unknown units, unsupported relations, and unresolvable references throw so the executor records a failed operation instead of putting a wrong answer on a map. The OGC adapter does not claim `analysis.buffer`, because OGC API - Features has no standard geometry-processing endpoint — so a buffer command fails preflight rather than halfway through.

`catalogFromOgcService(url)` builds the whole catalog from a live service — layers from `/collections`, typed fields from `/collections/{id}/queryables` — so pointing at an OGC endpoint takes three lines instead of a hand-written catalog. Crucially, it grants query capabilities only when the service advertises Part 3 filtering: a service that accepts a filter and silently returns everything gets no filter capability at all, and says why. [Details](docs/adapters.md#capabilities-follow-conformance-and-this-matters).

The OGC adapter needs a service conforming to OGC API - Features Part 3 (Filtering) and CQL2-Text; it pages by following the service's own `rel="next"` link and reports `truncated` rather than pretending a page-bounded result is complete. Proximity is expressed as intersection with a buffer polygon, which is a [bounded approximation, not an exact distance test](docs/adapters.md#proximity-queries-are-bounded-approximations).

`composeAdapters(data, view)` puts a data adapter and a map adapter behind one contract while keeping combined capabilities accurate.

See the [adapters guide](docs/adapters.md).

## Navigation without a geocoder

"Go to Delhi" should not mean an uncontrolled call to a third-party service. `createPlaceResolver` answers navigation from a place list your application owns:

```js
import { createPlaceResolver, createVoiceGISCore } from 'voicegis/core';

const gis = createVoiceGISCore({
  catalog,
  adapter,
  resolvers: [createPlaceResolver({
    places: [
      { id: 'india', name: 'India', kind: 'country', bounds: [[6.55, 68.11], [35.67, 97.4]] },
      { id: 'delhi', name: 'Delhi', kind: 'city', center: [28.7041, 77.1025], zoom: 9 },
    ],
  })],
});
```

Cities resolve to a centre; countries and regions resolve to bounds, so an adapter frames the whole extent instead of dropping a pin in the middle of it. A place that is not on the list returns `needs_input` with ranked suggestions rather than a guess:

```js
const plan = await gis.compile('go to Atlantis');
plan.issues[0];
// {
//   code: 'unknown_place',
//   severity: 'input',
//   message: '"atlantis" is not a known place. Did you mean Athens, Alaska, Santiago?',
//   details: { suggestions: ['Athens', 'Alaska', 'Santiago'], suggestionKind: 'did_you_mean' },
// }
```

Matching tolerates the transpositions that dominate spoken and typed place names, so `"Dehli"` resolves to Delhi. No network request is made at any point.

## Package entry points

| Import | Purpose |
|---|---|
| `voicegis/core` | Headless compiler, catalog, policy, adapter, and executor |
| `voicegis/adapters` | GeoJSON and OGC API - Features execution adapters, CQL2 translation |
| `voicegis/parser` | Legacy navigation and built-in map command parser |
| `voicegis/engines` | Optional Web Speech, Whisper, TF.js, and server transcription clients |
| `voicegis/map` | Legacy Leaflet/OpenLayers map-controller adapters |
| `voicegis/audio` | Microphone capture and waveform utilities |
| `voicegis/evaluation` | Parser evaluation tracker |
| `voicegis` | All public APIs plus the backward-compatible orchestrator |

All entry points ship as ESM and CommonJS with generated declarations.

## Existing VoiceGIS applications

The original browser orchestrator remains available:

```js
import { VoiceGIS } from 'voicegis';

const app = new VoiceGIS({
  mapEngine: 'leaflet',
  mapContainerId: 'map',
  speechEngine: 'webspeech',
});

await app.initSpeech();
app.start();
```

It is retained for backward compatibility. New production integrations should prefer `voicegis/core` so the host application keeps ownership of its map, data, permissions, and transcription UX.

## The demo

The [live demo](https://voicemap-three.vercel.app/) runs against the USGS feed of magnitude 2.5+ earthquakes from the past 30 days — real data, not a simulation. The counts on screen come from evaluating the compiled predicate against the features the map is drawing.

It is worth opening for three things:

- **The plan panel.** Every request shows its compiled operations with the catalog labels they resolved to, the permission each needs, and the result each produced.
- **The permission toggles.** Switch off `export`, ask for an export, and watch the command get blocked with a reason before anything runs.
- **The pipeline.** Compile → Ground → Authorize → Execute, showing exactly which stage a request stopped at and why.

Run it locally:

```bash
npm install
npm run dev
```

The demo lives in [`demo/`](demo/) and is a working reference integration: catalog, policy, confirmation dialog, execution receipts, and the GeoJSON adapter, in about 900 lines. Regenerate the animation above with `node scripts/record-demo.mjs`.

## Driving it from an agent (MCP)

[`mcp/`](mcp/) is a Model Context Protocol server that points at any OGC API -
Features service and lets an agent query it in plain language:

```bash
node mcp/src/cli.js --service https://demo.ldproxy.net/zoomstack
```

The agent never writes a query string. It sends a request, VoiceGIS compiles it
against a catalog derived from the service, checks it against permissions the
operator set when starting the server, and only then executes — returning the
typed plan and a receipt. A request naming a field that does not exist comes
back `needs_input`; one needing a permission that was not granted comes back
`blocked`. Nothing runs in either case.

The default is read-only. See [mcp/README.md](mcp/README.md).

## Documentation

- [VoiceGIS Core guide](docs/core.md)
- [Adapters guide](docs/adapters.md)
- [API reference](docs/api.md)
- [Runnable package example](examples/package-command-core.js)
- [Architecture](docs/ARCHITECTURE.md)
- [Next.js + Leaflet recipe](docs/recipes/nextjs-leaflet-dashboard.md)
- [Electron offline recipe](docs/recipes/electron-offline-kiosk.md)
- [Live demo](https://voicemap-three.vercel.app/) — compiles requests against live USGS earthquake data

## Development

```bash
npm test -- --runInBand   # unit tests
npm run test:e2e          # end-to-end suite (no external network required)
npm run lint
npm run evaluate
npm run build
```

The end-to-end suite drives Chrome through Playwright. Locally it uses the
installed Chrome so no browser bundle is downloaded; CI installs Playwright's
Chromium and sets `PLAYWRIGHT_BROWSER=chromium`. Every request the demo makes
is answered from a fixture, and anything outside the preview origin is blocked
and fails the run — so the suite passes with outbound networking disabled.

`npm run test:live-ogc` is an opt-in integration check that runs the OGC
adapter against a public ldproxy service. It needs the internet and is skipped
by the normal `npm test` run.

The release guard runs tests, lint, the ESM/CommonJS builds, and declaration generation before publishing.

### Known advisory: sharp via @huggingface/transformers

`npm audit` reports two high-severity findings for `sharp` (< 0.35.0,
GHSA-f88m-g3jw-g9cj). They are worth understanding rather than working around:

- `sharp` is not a dependency of the published package. VoiceGIS ships **zero
  runtime dependencies**, which `npm run validate:package` enforces. It arrives
  only through `@huggingface/transformers`, a devDependency and an *optional*
  peer dependency for the Whisper engine.
- The latest `@huggingface/transformers` (4.2.0) pins `sharp: ^0.34.5`. That
  range cannot reach the fixed 0.35.0, and 0.34.5 is the last 0.34 release, so
  there is no non-forced upgrade. Overriding it would push an untested major
  onto that package.
- `sharp` is a native **image** library used by the transformers image
  pipelines. VoiceGIS only uses transformers for audio transcription and never
  reaches that code. The browser path uses `onnxruntime-web`, not `sharp`, and
  the demo bundle contains neither.

The exposure is therefore contributors running `npm install` in this repo, and
consumers who explicitly opt into the Whisper peer dependency on Node. Removing
the devDependency would drop `sharp` entirely, but the Whisper unit tests mock
the module by specifier and `tsc` resolves it for declarations, so it needs a
module stub for both first — tracked, not yet done.

## Scope and limitations

VoiceGIS Core is a deterministic command compiler, not a general conversational model. A catalog must define application concepts, and an adapter must implement application behavior. Ambiguous commands return `needs_input`; forbidden commands return `blocked`. The package never silently invents a field, executes generated SQL, or grants itself a permission.

The compiler, catalog, policy, executor, and plan schema are stable, and every plan carries an operation and schema version so integrations can validate the contract they were built against.

Two areas are newer than the rest and may still change within 2.x:

- **The OGC API - Features adapter** has been validated against one conformant service. The CQL2 it emits follows the specification and its [conformance requirements are documented](docs/adapters.md#required-service-conformance), but its options may need to change as more implementations are tested.
- **`createPlaceResolver`** covers navigation phrasings and gazetteer shapes that will likely grow.

The GeoJSON adapter, and everything under `voicegis/core`, are not expected to change in a breaking way before 3.0.

## License

MIT © Sanish Kumar
