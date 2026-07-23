# VoiceGIS Core integration guide

VoiceGIS Core is designed for applications that already have a map, spatial data, authentication, and business rules. It adds a controlled natural-language command boundary without taking ownership of those systems.

## Integration model

There are four application-owned boundaries:

1. **Input:** text from a keyboard, microphone transcript, call transcript, or another service.
2. **Catalog:** the layers, aliases, fields, and capabilities the current user can talk about.
3. **Policy:** the operations the current user is authorized to request and which require confirmation.
4. **Adapter:** functions that translate typed VoiceGIS operations to the application's SDK or backend.

The compiler produces a plan between those boundaries. The application can render it, log it, reject it, ask for clarification, or execute it.

## Build a user-scoped catalog

Catalogs should reflect what a user can currently see. Do not put a sensitive layer into a public user's catalog and rely only on UI hiding.

```js
const catalog = {
  version: `${tenant.id}:${permissions.revision}`,
  layers: permissions.layers.map((layer) => ({
    id: layer.id,
    label: layer.displayName,
    aliases: layer.voiceAliases,
    fields: layer.queryableFields.map((field) => ({
      id: field.apiName,
      label: field.displayName,
      aliases: field.aliases,
      type: field.type,
      unit: field.unit,
    })),
    capabilities: layer.allowedOperations,
  })),
};
```

Using stable backend ids prevents a spoken label from leaking into a query as an identifier.

## Translate predicates, do not concatenate them

For an ArcGIS, Mapbox, PostGIS, or custom backend integration, write a translator from the predicate AST to the target SDK's safe parameter format. Validate fields against the same catalog again on the server.

```js
function evaluatePredicate(feature, predicate) {
  if (predicate.type === 'group') {
    const values = predicate.conditions.map((condition) =>
      evaluatePredicate(feature, condition)
    );
    return predicate.operator === 'and'
      ? values.every(Boolean)
      : values.some(Boolean);
  }

  const actual = feature.properties[predicate.field];
  const expected = predicate.value;

  switch (predicate.operator) {
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    case 'gt': return actual > expected;
    case 'gte': return actual >= expected;
    case 'lt': return actual < expected;
    case 'lte': return actual <= expected;
    case 'contains': return String(actual).includes(String(expected));
    case 'not_contains': return !String(actual).includes(String(expected));
    case 'starts_with': return String(actual).startsWith(String(expected));
    default: throw new Error(`Unsupported operator: ${predicate.operator}`);
  }
}
```

Units remain explicit in the predicate. Convert them only when the layer schema requires a different unit.

## Connect an existing application

```js
import {
  OPERATION,
  createFunctionAdapter,
  createVoiceGISCore,
} from 'voicegis/core';

const adapter = createFunctionAdapter({
  [OPERATION.LAYER_VISIBILITY]: ({ target, args }) => {
    layerRegistry.get(target.layerId).setVisible(args.visible);
  },

  [OPERATION.QUERY_FILTER]: async ({ target, args, context }) => {
    const features = await api.query(target.layerId, args.predicate, {
      signal: context.signal,
    });
    resultsPanel.replace(features);
    return { featureCount: features.length };
  },

  [OPERATION.QUERY_SPATIAL_SELECT]: async ({ target, args, context }) => {
    const ids = await api.spatialSelect({
      layerId: target.layerId,
      relation: args.relation,
      distance: args.distance,
      reference: args.reference,
      signal: context.signal,
    });
    selection.set(target.layerId, ids);
    return { selectedCount: ids.length };
  },

  [OPERATION.DATA_EXPORT]: async ({ target, args }) => {
    return api.exportSelection({ target, format: args.format });
  },
});
```

Handlers can return any serializable or application-specific value. It is attached to the corresponding receipt result.

## Render plan states

Treat plan state as UX, not just error handling.

| Status | Recommended UI |
|---|---|
| `ready` | Show the interpreted action and allow immediate execution |
| `needs_input` | Display the issue and focus a clarification input |
| `needs_confirmation` | Summarize the risky operations and request approval |
| `blocked` | Explain the missing permission or unsupported layer capability |

Never reinterpret a blocked plan in the adapter. Change the catalog or policy intentionally and compile again.

## Confirmation and receipts

```js
const receipt = await gis.execute(plan, {
  confirm: async (operation) => {
    const description = describeOperation(operation);
    return modal.confirm({
      title: 'Confirm GIS action',
      body: description,
    });
  },
  onEvent: (event) => {
    audit.append({
      actorId: session.user.id,
      catalogVersion: plan.meta.catalogVersion,
      ...event,
    });
  },
});
```

The executor confirms every gated operation before the first side effect. If a later handler fails, the receipt is `partial` only when an earlier handler already succeeded.

## Server-side execution

The core works in Node.js as well as the browser. A strong production design compiles in the client for immediate feedback and validates or recompiles on the server before protected work:

```text
client transcript
  → client plan preview
  → authenticated API request
  → server catalog + server policy
  → server compile/preflight
  → data service
  → receipt
```

Do not trust a client-created plan as authorization. The plan is an interoperable request and audit format, not a security token.

`VoiceGISCore` now revalidates the plan against its trusted catalog at execution
time. For split client/server deployments, validate the submitted plan with the
server-owned catalog before passing it to an executor:

```js
import { validateCommandPlan } from 'voicegis/core';

const validation = validateCommandPlan(request.body.plan, serverCatalog);
if (!validation.valid) {
  return reply.status(400).send({ issues: validation.issues });
}
```

Catalog versions are strict by default, so permission or schema changes
invalidate plans compiled against an older catalog instead of silently executing
them under new assumptions.

## Add domain phrases

Custom resolvers are useful for business language that maps to a stable built-in operation:

```js
gis.addResolver(({ text, catalog }) => {
  const match = text.match(/^show priority (\d) calls$/i);
  if (!match) return null;

  const layer = catalog.resolveLayer('incidents')?.layer;
  if (!layer) return null;

  return {
    type: OPERATION.QUERY_FILTER,
    target: { kind: 'layer', layerId: layer.id },
    args: {
      predicate: {
        type: 'comparison',
        field: 'priority',
        operator: 'eq',
        value: Number(match[1]),
      },
    },
  };
});
```

Resolvers run in registration order before built-in parsing. Keep them deterministic and return `null` when they do not own a phrase.

## Connect speech

The core expects final text. A Web Speech example:

```js
recognition.addEventListener('result', async (event) => {
  const result = event.results[event.resultIndex];
  if (!result.isFinal) return;

  const transcript = result[0].transcript;
  const plan = await gis.compile(transcript);
  renderPlan(plan);
});
```

Use interim transcripts only for UI feedback. Compile a final transcript to avoid executing partial phrases.

## Production checklist

- Build the catalog from server-authorized resources.
- Give every layer and field a stable id.
- Declare only operations that the layer actually supports.
- Start with the default view/query policy and add permissions deliberately.
- Require confirmation for exports, edits, analysis, and custom high-impact work.
- Translate the predicate AST using parameterized SDK/backend APIs.
- Revalidate catalog ids and policy on the server; keep strict catalog-version checks enabled.
- Pass an `AbortSignal` when operations can be cancelled.
- Store receipts with actor, tenant, catalog version, and request correlation id.
- Test common accents and transcription mistakes using the actual speech provider.
- Offer a text input and an editable plan preview as accessibility and recovery paths.
