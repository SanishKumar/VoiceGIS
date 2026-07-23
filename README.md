<div align="center">
  <h1>VoiceGIS</h1>
  <p><strong>The control plane between natural-language requests and real GIS applications.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/voicegis"><img src="https://img.shields.io/npm/v/voicegis" alt="npm version"></a>
    <a href="https://voicemap-three.vercel.app/"><img src="https://img.shields.io/badge/live-VoiceGIS_Atlas-ff6b35" alt="Live VoiceGIS Atlas demo"></a>
    <a href="https://github.com/SanishKumar/VoiceGIS/actions"><img src="https://img.shields.io/github/actions/workflow/status/SanishKumar/VoiceGIS/ci.yml?label=tests" alt="Test status"></a>
    <img src="https://img.shields.io/badge/runtime_dependencies-0-1f8a70" alt="Zero runtime dependencies">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license">
  </p>
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
- **No hidden network calls:** Core's geocoding is disabled unless the application explicitly enables and supplies it.
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

## Package entry points

| Import | Purpose |
|---|---|
| `voicegis/core` | Headless compiler, catalog, policy, adapter, and executor |
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

## Documentation

- [VoiceGIS Core guide](docs/core.md)
- [API reference](docs/api.md)
- [Runnable package example](examples/package-command-core.js)
- [Architecture](docs/ARCHITECTURE.md)
- [Next.js + Leaflet recipe](docs/recipes/nextjs-leaflet-dashboard.md)
- [Electron offline recipe](docs/recipes/electron-offline-kiosk.md)
- [VoiceGIS Atlas live demo](https://voicemap-three.vercel.app/)

## Development

```bash
npm test -- --runInBand
npm run lint
npm run evaluate
npm run build
```

The release guard runs tests, lint, the ESM/CommonJS builds, and declaration generation before publishing.

## Scope and limitations

VoiceGIS Core is a deterministic command compiler, not a general conversational model. A catalog must define application concepts, and an adapter must implement application behavior. Ambiguous commands return `needs_input`; forbidden commands return `blocked`. The package never silently invents a field, executes generated SQL, or grants itself a permission.

The package is currently a beta. Operation and plan versions are included so integrations can validate contracts as the API evolves.

## License

MIT © Sanish Kumar
