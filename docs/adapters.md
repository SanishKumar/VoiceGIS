# VoiceGIS adapters

`voicegis/adapters` provides working execution adapters so a compiled plan can
do real work without writing an integration first. They are ordinary
implementations of the adapter contract — `supports(type)` and
`execute(operation, context)` — so anything here can be replaced by your own.

```bash
npm install voicegis
```

```js
import { createGeoJSONAdapter, createOgcApiFeaturesAdapter } from 'voicegis/adapters';
```

Both adapters translate the typed predicate AST. Neither builds a query by
concatenating user speech.

## GeoJSON adapter

Executes operations against in-memory feature collections. Most open spatial
data is published as GeoJSON, which makes this the fastest path from a catalog
to something that answers questions.

```js
import { createVoiceGISCore } from 'voicegis/core';
import { createGeoJSONAdapter } from 'voicegis/adapters';

const adapter = createGeoJSONAdapter({
  layers: {
    parcels: parcelFeatureCollection,
    hydrants: hydrantFeatureCollection,
  },
  catalog,                       // supplies field units
  onChange: (state) => render(state),
  onExport: ({ content, filename, mimeType }) => save(content, filename, mimeType),
});

const gis = createVoiceGISCore({ catalog, adapter });
const { receipt } = await gis.run('show parcels where area is greater than 2 hectares');
```

### Supported operations

| Operation | Behaviour |
|---|---|
| `layer.visibility` | Records visibility; the host renders |
| `query.filter` | Evaluates the predicate, stores the matched set |
| `query.select` | Evaluates the predicate into the selection |
| `query.spatial_select` | Geodesic proximity against a reference layer |
| `query.count` | Counts by predicate, or counts the active filter |
| `query.clear` | Clears filters on one layer or all layers |
| `selection.clear` | Clears the selection |
| `analysis.buffer` | Geodesic circles around point features |
| `data.export` | GeoJSON, JSON, CSV, or KML |

### State and rendering

The adapter owns query state and never touches a map. After every mutation it
calls `onChange` with a serializable snapshot:

```js
{
  layers: {
    parcels: { visible: true, total: 5120, matched: 47, selected: 0, filter: {…} },
  },
  selection: { parcels: ['p-1', 'p-2'] },
  buffers: { type: 'FeatureCollection', features: [...] },
}
```

Read features for drawing with `getFeatures(layerId, { scope })`, where `scope`
is `'all'`, `'filtered'` (default), or `'selected'`.

Refreshing a live feed keeps the user's query applied:

```js
adapter.setLayerData('incidents', await fetchLatest());
// An active filter is re-evaluated; selected ids that vanished are dropped.
```

### Deliberate limits

`analysis.buffer` handles point geometry only. Offsetting lines and polygons is
real computational geometry, and returning an approximate shape from a command
the user believes is exact would be worse than refusing, so it throws instead.
Buffer those in your spatial backend.

Buffers around points are **polygon approximations of a geodesic circle**, not
exact circles: 64 segments by default (`bufferSteps`), inscribed, so the shape
falls short of the true circle by at most about 0.12% of the radius. Distances
use a sphere rather than the WGS84 ellipsoid, which differs by up to ~0.5%.

`query.spatial_select` is not affected by that approximation — it measures
point-to-geometry distance directly with the haversine formula and compares it
to the requested distance, so the only error there is the spherical-Earth
assumption. Distance to line and area geometry is computed as the minimum over
each geometry's vertices against the other's edges, which is exact for
point-to-boundary cases and the standard approximation otherwise.

## OGC API - Features adapter

> **Experimental.** This adapter has been validated end to end against one
> conformant service (ldproxy). The CQL2 it emits follows the specification and
> the conformance it needs is listed below, but implementations vary in what
> they accept, and its options may change within 2.x as more are tested. Check
> `/conformance` before relying on it, and please report what you find.

Translates predicates to CQL2-Text and sends them as the standard `filter`
parameter defined by OGC API - Features Part 3.

```js
const adapter = createOgcApiFeaturesAdapter({
  baseUrl: 'https://example.org/ogc',
  collections: { incidents: 'emergency_incidents' },  // layerId → collectionId
  catalog,
  geometryProperty: 'geom',
});
```

A compiled predicate becomes a filtered request:

```text
{ type: 'comparison', field: 'mag', operator: 'gt', value: 5 }

GET /collections/quakes/items?f=json&limit=500
      &filter=mag%20%3E%205
      &filter-lang=cql2-text
```

`query.count` first requests a single feature and reads `numberMatched`, so
counting does not page an entire collection. If the service omits it, the
adapter pages and counts, and reports which path it used in the receipt.

### Required service conformance

This adapter is not a generic WFS client. The service must advertise these
OGC API - Features conformance classes:

| Conformance class | Needed for |
|---|---|
| `.../conf/core` | `/collections/{id}/items`, `numberMatched`, `rel="next"` links |
| `.../conf/geojson` | GeoJSON responses |
| Part 3 `.../conf/filter` | the `filter` and `filter-lang` query parameters |
| Part 3 `.../conf/features-filter` | applying `filter` to the items resource |
| CQL2 `.../conf/cql2-text` | the `cql2-text` encoding this adapter emits |
| CQL2 `.../conf/basic-cql2` | comparison operators, `AND`/`OR`, `IS NULL` |
| CQL2 `.../conf/basic-spatial-operators` | `S_INTERSECTS`, used for proximity |

Two further classes are needed only for specific features:

- `.../conf/advanced-comparison-operators` — `LIKE`, used by `contains`,
  `not_contains`, and `starts_with`.
- `.../conf/case-insensitive-comparison` — `CASEI()`, used only when you pass
  `caseInsensitive: true`. It is **off by default** precisely because support
  is uneven.

Field names in your catalog must be *queryables* the service exposes, and
`geometryProperty` must be the queryable name of the geometry (it is `geom` by
default; many services use `geometry`). A service that accepts the request but
does not implement the filter class may ignore the filter and return
everything, so verify against `/conformance` before trusting results.

### Pagination

Paging follows the `rel="next"` link the service returns, resolved against the
URL it came from, so relative hrefs and opaque cursors both work. The adapter
never synthesises `offset`: cursor-based services do not accept it, and on a
result set that shifts between requests offset paging silently skips or
repeats features.

Paging stops at `maxPages` (default 20). A `rel="next"` pointing at a different
origin throws unless you opt in with `followCrossOrigin: true`. A service that
links back to a page it already served throws too: a cycle cannot be paged to
completion, and returning the prefix gathered so far would be an arbitrary
subset presented as the whole result.

### Completeness

Every query result carries `complete`. It is `false` when paging stopped at
`maxPages`, or when the service reported a `numberMatched` larger than the
number of features it actually returned.

What that flag means depends on what the operation is for, so the adapter
treats the cases differently rather than applying one rule:

| Operation | Behaviour when the result is incomplete |
|---|---|
| `query.filter`, `query.select` | Succeeds with `complete: false`, `truncated`, and `returned` vs `matched`. A map showing a subset is useful; a caller can see it is a subset. |
| `query.count` | **Throws.** A count that stopped early is not a count, and the caller asked "how many", not "how many did you manage to read". Only the `numberMatched` path, or a fully paged read, produces a number. |
| `query.spatial_select` | **Throws** if the reference layer was truncated by `referenceLimit`. Measuring against a subset of the references silently omits every feature near the ones that were not fetched — a wrong selection, not a partial one. |
| `data.export` | **Throws** unless `allowPartial: true`. An export leaves the application and is treated as a dataset; handing out a prefix under the layer's name misrepresents it. The opt-in returns `complete: false` in the receipt. |

```js
const result = await gis.execute(plan);
// query.filter on a large collection
// → { matched: 48210, returned: 10000, pages: 20, truncated: true, complete: false }
```

If you routinely hit `truncated`, raise `maxPages` or `limit`, or narrow the
query — do not paper over it with `allowPartial`.

### Proximity queries are bounded approximations

CQL2's standard function set has no distance operator, so proximity is
expressed as intersection with a buffer polygon computed client-side:

```text
S_INTERSECTS(geom, POLYGON((…)))
```

This is portable across conformant servers rather than relying on a vendor
extension, but be precise about what it is: **an approximation with a bounded
error, not an exact distance test.**

- The buffer is a polygon of `32` segments (`64` in the GeoJSON adapter's
  `analysis.buffer`) inscribed on a geodesic circle. Vertices lie exactly on
  the circle; the chords between them fall inside it. A regular *n*-gon
  inscribed in a circle of radius *r* is short of the arc by at most
  `r · (1 − cos(π/n))` — about **0.5% of the radius at 32 segments** and
  **0.12% at 64**. So a "within 5 km" query can miss features between roughly
  4.976 km and 5 km from the reference. Raise the segment count if that
  matters for your use case.
- Distances are computed on a sphere of radius 6 371 008.8 m, not on the
  WGS84 ellipsoid. Ellipsoidal distance differs by up to ~0.5% depending on
  latitude and bearing.
- Coordinates in the emitted WKT are rounded to six decimal places (~0.1 m).
- The service performs the intersection in its own CRS. If the collection is
  not in CRS84, results depend on how the service reprojects the polygon.

For an exact geodesic distance test, use a backend with a real spatial
function — PostGIS `ST_DWithin` on `geography`, for example — rather than this
adapter.

Reference layers must be point geometry; a non-point reference throws, because
buffering an arbitrary polygon correctly is server-side work.

### No buffer capability

`OGC_ADAPTER_CAPABILITIES` deliberately omits `analysis.buffer`: OGC API -
Features has no standard geometry-processing endpoint. A buffer command
therefore fails preflight with a clear message instead of failing halfway
through a workflow. This is the capability contract doing its job.

## Composing adapters

Data and map concerns usually belong in different places. `composeAdapters`
puts them behind one contract, and the executor still sees accurate combined
capabilities:

```js
import { composeAdapters, createGeoJSONAdapter } from 'voicegis/adapters';
import { createFunctionAdapter, OPERATION } from 'voicegis/core';

const data = createGeoJSONAdapter({ layers, catalog });
const view = createFunctionAdapter({
  [OPERATION.VIEW_ZOOM]: ({ args }) => map.setZoom(map.getZoom() + args.delta),
  [OPERATION.VIEW_RESET]: () => map.setView(home, 4),
});

const gis = createVoiceGISCore({ catalog, adapter: composeAdapters(data, view) });
```

Earlier adapters win when more than one supports an operation.

## Building your own

The exported helpers are the useful parts if you are targeting ArcGIS, PostGIS,
Mapbox, or an internal service:

| Export | Purpose |
|---|---|
| `evaluatePredicate(predicate, properties, options)` | Evaluate the AST in memory |
| `predicateToCql2(predicate, options)` | Translate the AST to CQL2-Text |
| `geometryDistanceMeters(a, b)` | Geodesic distance between geometries |
| `geodesicCircle(center, radiusMeters, steps)` | Buffer ring as a polygon |
| `distanceToMeters(distance)` | Normalize a compiled distance |
| `convertUnit(value, from, to)` | Convert within a dimension, throw across one |
| `serializeFeatures(features, format)` | GeoJSON, JSON, CSV, KML |

Two rules the built-in adapters follow, worth keeping in your own:

1. **Never guess.** Unknown units, unsupported relations, and unresolvable
   references throw `AdapterEvaluationError` so the executor records a failed
   operation. A wrong answer on a map is more expensive than an error.
2. **Report capabilities honestly.** `supports()` should describe what the
   adapter can actually do, so unsupported work fails during preflight rather
   than after a side effect has already landed.

## Null and unit semantics

Attribute comparison follows SQL-like null handling: a null or missing property
is false for every comparison except an explicit null equality check.

When the catalog declares a unit and the speaker used a different one, the
value is converted before comparison. Converting across dimensions — a length
against an area — throws rather than comparing incompatible magnitudes.

```js
// Stored in hectares, spoken in acres: converted.
{ field: 'area', operator: 'gt', value: 10, unit: 'acre' }

// Stored in hectares, spoken in kilometres: throws.
{ field: 'area', operator: 'gt', value: 10, unit: 'kilometer' }
```
