# VoiceGIS API reference

The recommended API is the headless `voicegis/core` entry point. The original speech and map orchestrator remains available for backward compatibility.

## Core factory

### `createVoiceGISCore(options)`

Creates a `VoiceGISCore` instance.

```js
import { createVoiceGISCore } from 'voicegis/core';

const gis = createVoiceGISCore({
  catalog,
  policy,
  adapter,
  enableGeocoding: false,
  geocoder,
  resolvers,
  clock,
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `catalog` | `object \| SpatialCatalog` | Empty catalog | Layers, fields, aliases, and optional layer capabilities |
| `policy` | `object \| CommandPolicy` | View and query only | Permission, allow, deny, and confirmation rules |
| `adapter` | `object` | `null` | Host application's execution adapter |
| `enableGeocoding` | `boolean` | `false` | Allows the legacy navigation fallback to use the supplied geocoder |
| `geocoder` | `object` | Legacy geocoder | Object with an async `geocode(place)` method |
| `resolvers` | `Function[]` | `[]` | Domain-specific command resolvers, evaluated before built-ins |
| `strictCatalogVersion` | `boolean` | `true` | Rejects execution when the plan and trusted catalog versions differ |
| `clock` | `Function` | `Date.now` | Time source used by plans and receipts |

### `VoiceGISCore.compile(input)`

Returns a promise for a serializable command plan. Compilation does not call the adapter.

### `VoiceGISCore.execute(plan, options)`

Preflights and executes a plan. Returns an execution receipt.

### `VoiceGISCore.run(input, options)`

Compiles and executes, returning `{ plan, receipt }`.

### `VoiceGISCore.addResolver(resolver)`

Registers a custom resolver and returns a function that unregisters it.

## `SpatialCatalog`

```js
import { SpatialCatalog } from 'voicegis/core';

const catalog = new SpatialCatalog({
  version: '2026.07',
  layers: [{
    id: 'parcels',
    label: 'Land parcels',
    aliases: ['plots'],
    fields: [{
      id: 'area_ha',
      label: 'Area',
      aliases: ['size'],
      type: 'number',
      unit: 'hectare',
    }],
    capabilities: ['layer.visibility', 'query.filter'],
  }],
});
```

Layer and field definitions may also be object maps keyed by id.

Methods:

| Method | Returns | Description |
|---|---|---|
| `resolveLayer(value, options?)` | Match or `null` | Resolves an id, label, alias, or close spelling |
| `findLayer(text)` | Match or `null` | Finds the longest catalog layer name in free text |
| `resolveField(layer, value, options?)` | Match or `null` | Resolves a field within one layer |
| `supports(layer, operationType)` | `boolean` | Checks a declared layer capability; omitted capability lists defer to the adapter |
| `toJSON()` | `object` | Returns the serializable catalog |

## Catalog-bound plan validation

`VoiceGISCore` automatically validates plans against its catalog immediately
before execution. The check uses stable ids only and rejects stale catalog
versions, unknown layer ids, unknown predicate fields, invalid predicate shapes,
duplicate operation ids, and missing layer capabilities.

Use `validateCommandPlan` when validation and execution happen in different
services:

```js
import { validateCommandPlan } from 'voicegis/core';

const { valid, issues } = validateCommandPlan(plan, trustedServerCatalog);
```

For a reusable validator, construct
`new CommandPlanValidator(catalog, { strictCatalogVersion: true })` and call
`validator.validate(plan)`.

## `CommandPolicy`

```js
const policy = new CommandPolicy({
  permissions: ['view', 'query', 'analysis', 'export'],
  allow: ['view.*', 'layer.*', 'query.*', 'analysis.buffer', 'data.export'],
  deny: ['feature.add'],
  confirm: ['analysis.buffer', 'data.export'],
});
```

Rules use exact operation names or a trailing wildcard such as `query.*`. `deny` wins over `allow`.

`policy.evaluate(operation)` returns:

```js
{
  allowed: true,
  permission: 'query',
  risk: 'low',
  requiresConfirmation: false,
  reason: null,
}
```

The default policy grants `view` and `query`. `CommandPolicy.permissive()` grants every permission; use it intentionally.

## `SpatialCommandCompiler`

`new SpatialCommandCompiler(options)` accepts the same catalog, policy, geocoding, resolver, and clock options as the facade.

`compiler.compile(input)` returns:

| Field | Description |
|---|---|
| `version` | Plan contract version |
| `id` | Unique plan id |
| `input` | Normalized source text |
| `status` | `ready`, `needs_input`, `needs_confirmation`, or `blocked` |
| `operations` | Ordered typed operations |
| `issues` | Clarification and policy/capability explanations |
| `requirements` | Unique capabilities, permissions, and confirmation operation ids |
| `meta` | Catalog version, creation time, and compiler id |

`splitSpatialCommand(text)` exposes the command-chain splitter. It does not split an ordinary `and` inside a filter unless another operation verb follows it.

## Operations

Import stable identifiers through `OPERATION`.

| Constant | Value | Permission |
|---|---|---|
| `VIEW_ZOOM` | `view.zoom` | `view` |
| `VIEW_PAN` | `view.pan` | `view` |
| `VIEW_SET` | `view.set` | `view` |
| `VIEW_RESET` | `view.reset` | `view` |
| `LAYER_VISIBILITY` | `layer.visibility` | `view` |
| `FEATURE_ADD` | `feature.add` | `edit` |
| `QUERY_FILTER` | `query.filter` | `query` |
| `QUERY_CLEAR` | `query.clear` | `query` |
| `QUERY_SELECT` | `query.select` | `query` |
| `QUERY_SPATIAL_SELECT` | `query.spatial_select` | `query` |
| `QUERY_COUNT` | `query.count` | `query` |
| `SELECTION_CLEAR` | `selection.clear` | `query` |
| `ANALYSIS_BUFFER` | `analysis.buffer` | `analysis` |
| `DATA_EXPORT` | `data.export` | `export` |
| `HISTORY_UNDO` | `history.undo` | `edit` |
| `HISTORY_REDO` | `history.redo` | `edit` |
| `ADAPTER_SWITCH` | `adapter.switch` | `admin` |

Operation metadata is exported as `OPERATION_METADATA`. `PLAN_STATUS`, `RISK`, and `PERMISSION` provide the other stable constants.

## Predicate AST

VoiceGIS emits data, not executable query strings.

Comparison:

```js
{
  type: 'comparison',
  field: 'area_ha',
  operator: 'gte',
  value: 2,
  unit: 'hectare',
}
```

Group:

```js
{
  type: 'group',
  operator: 'and',
  conditions: [
    { type: 'comparison', field: 'status', operator: 'eq', value: 'open' },
    { type: 'comparison', field: 'severity', operator: 'gte', value: 3 },
  ],
}
```

Supported comparison operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `not_contains`, and `starts_with`.

## `createFunctionAdapter`

```js
const adapter = createFunctionAdapter({
  [OPERATION.QUERY_FILTER]: async ({ operation, target, args, context }) => {
    return dataStore.filter(target.layerId, args.predicate, {
      signal: context.signal,
    });
  },
}, {
  name: 'city-dashboard',
});
```

The handler keys become adapter capabilities. An adapter exposes:

```js
{
  name,
  capabilities,
  supports(type),
  execute(operation, context),
}
```

Custom adapters can implement this contract directly.

## `CommandExecutor`

```js
const executor = new CommandExecutor({ adapter, policy, catalog });
const receipt = await executor.execute(plan, {
  confirm: async (operation, plan) => true,
  signal: abortController.signal,
  stopOnError: true,
  onEvent: (event) => console.log(event),
});
```

Execution is preflighted before the first handler runs. Policy denial, missing adapter capability, missing confirmation, or an already-aborted signal produces a receipt without performing the operation.

When `catalog` is supplied, preflight also validates the plan schema, catalog
version, stable layer ids, referenced layers, predicate fields, and declared
layer capabilities. `VoiceGISCore` supplies its catalog automatically. A
standalone executor remains backward-compatible when no catalog is supplied.

Receipt statuses are `succeeded`, `partial`, `failed`, `cancelled`, and `needs_confirmation`.

Lifecycle event types:

- `execution.started`
- `execution.rejected`
- `operation.confirmed`
- `operation.started`
- `operation.completed`
- `operation.failed`
- `execution.completed`

## Custom resolvers

A resolver receives `{ text, catalog, policy, compiler }` and returns `null`, one operation, an operation array, or `{ operations, issues }`.

```js
gis.addResolver(({ text }) => {
  const match = text.match(/^open work order (WO-\d+)$/i);
  if (!match) return null;

  return {
    type: 'app.work_order.open',
    target: { kind: 'work_order', id: match[1] },
    args: {},
  };
});
```

Custom operation types require a policy and adapter that recognize them. The built-in `CommandPolicy` intentionally rejects unknown operation types; applications can resolve to a built-in type or implement their own policy contract.

## Legacy APIs

### `VoiceGIS`

```js
import { VoiceGIS } from 'voicegis';

const app = new VoiceGIS({
  mapEngine: 'leaflet',
  mapContainerId: 'map',
  speechEngine: 'webspeech',
  autoExecute: true,
});
```

Methods include `initSpeech()`, `start()`, `stop()`, `registerCommand()`, and `use()`.

### `parseCommand(text, options?)`

Available from `voicegis/parser`. The legacy parser returns `{ intent, payload, raw, confidence }`. Unlike Core, its legacy default enables Nominatim geocoding; pass `{ enableGeocoding: false }` to disable it.

### Optional modules

- `voicegis/engines`: `WebSpeechEngine`, `WhisperEngine`, `WhisperServerEngine`, `TfjsEngine`, and `createEngine`
- `voicegis/map`: `MapController`, `LeafletAdapter`, and `OpenLayersAdapter`
- `voicegis/audio`: `AudioCapture` and `WaveformRenderer`
- `voicegis/evaluation`: `EvaluationTracker`
