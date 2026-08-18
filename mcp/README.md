# voicegis-mcp

An MCP server that lets an agent query a spatial data service in plain
language — without being able to invent a field, a layer, or a permission.

> **Pre-release.** Not yet published. The `voicegis` dependency is a local file
> link; switch it to a version range before publishing.

## The problem

Give a model a spatial API and it will write queries. Some of them reference
columns that do not exist, and the interesting failures are the quiet ones. The
public pygeoapi demo, for instance, advertises the CQL2 encoding but not OGC
API - Features Part 3 filtering. Send it a filter anyway:

```
GET /collections/lakes/items?filter=name LIKE '%Huron%'&filter-lang=cql2-text
→ 200 OK, numberMatched: 25
→ Lake Baikal | Lake Winnipeg | Great Slave Lake | L. Ontario | L. Erie
```

No error. The filter was ignored and every feature came back, and an agent has
no way to tell that from a correct answer.

## What this does instead

The agent sends a request in plain language. It never writes a query string.

1. **Ground.** The catalog is derived from the service itself — `/collections`
   for layers, `/collections/{id}/queryables` for typed fields. A request
   naming anything outside it is refused, with the reason.
2. **Authorize.** The operator grants permissions when starting the server. The
   agent gets those and nothing more.
3. **Execute.** Only then, and every operation comes back with a receipt.

Capabilities are derived from `/conformance`, so a service that cannot filter
is never offered filtering. That is what stops the pygeoapi case above from
reaching the agent as a confident wrong answer.

## Usage

```bash
node src/cli.js --service https://demo.ldproxy.net/zoomstack
```

In an MCP client config:

```json
{
  "mcpServers": {
    "voicegis": {
      "command": "npx",
      "args": ["voicegis-mcp", "--service", "https://demo.ldproxy.net/zoomstack"]
    }
  }
}
```

### Options

| Flag | Meaning |
|---|---|
| `--service <url>` | OGC API - Features landing page. Required. |
| `--allow <perms>` | Permissions to grant. Default `view,query`. Also `analysis`, `export`. |
| `--include <ids>` | Only expose these collections. |
| `--exclude <ids>` | Skip these collections. |
| `--limit <n>` | Page size requested from the service. Default 500. |
| `--max-pages <n>` | Pagination bound. Default 20. |

The default is read-only. Exporting data requires `--allow view,query,export`,
which is a decision the operator makes once, not one the agent can talk its way
into.

## Tools

**`describe_data`** — the layers, fields and operations that exist, the
permissions granted, and anything the service cannot do. Worth calling first.

**`preview_command`** — compile a request into a typed plan and return it
without running it.

**`run_command`** — compile, check, execute, and return the plan plus a
per-operation receipt. Pass `includeFeatures` to get matching features back.

A resource at `voicegis://catalog` exposes the derived catalog for clients that
prefer to read it directly.

## What a refusal looks like

```jsonc
// run_command: "show airports where runway_length is above 2000"
{
  "status": "needs_input",
  "executed": false,
  "reason": "Part of this request could not be resolved against the catalog.",
  "issues": [{ "code": "unknown_field", "message": "Field \"runway_length\" is not defined on layer \"airports\"." }],
  "hint": "Call describe_data for the layers, fields and operations that exist."
}
```

```jsonc
// run_command: "export airports as geojson"  (started without --allow export)
{
  "status": "blocked",
  "executed": false,
  "reason": "The policy for this session does not permit part of this request.",
  "issues": [{ "code": "policy_denied", "message": "Permission \"export\" is required for \"data.export\"." }]
}
```

Nothing ran in either case. A half-understood request executes none of its
parts, so an agent cannot get a partial side effect it did not intend.

## Tests

```bash
npm test
```

Eleven tests drive the server through a real MCP client over an in-memory
transport, against a stub service: tool discovery, grounding, execution,
refusals for unknown fields and layers, policy blocking, permission grants,
preview-without-execution, and a non-filtering service exposing no query tools.

## Limitations

- OGC API - Features only. A GeoJSON-file mode and other backends are the
  obvious next step.
- No confirmation flow: an MCP session has no operator present to confirm, so
  operations that would need one are simply not permitted unless granted.
- Language coverage is the deterministic compiler's, which is narrow but
  precise. It refuses rather than guesses, so expect `needs_input` on phrasings
  it does not know.
- Results are bounded by `--max-pages`; a truncated result is reported as such
  rather than presented as complete.

MIT © Sanish Kumar
