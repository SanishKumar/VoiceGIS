import { parseCommand, INTENT } from '../parser/CommandParser.js';
import { SpatialCatalog } from './SpatialCatalog.js';
import { CommandPolicy } from './CommandPolicy.js';
import { OPERATION, PLAN_STATUS } from './constants.js';
import { CORE_SCHEMA_VERSION } from './types.js';

let sequence = 0;

const OPERATION_START = [
  'show', 'display', 'enable', 'turn on', 'hide', 'remove', 'disable', 'turn off',
  'filter', 'select', 'count', 'clear', 'buffer', 'export', 'zoom', 'pan', 'move',
  'go', 'fly', 'navigate', 'center', 'reset', 'add', 'drop', 'switch', 'undo', 'redo',
].join('|').replaceAll(' ', '\\s+');

const CONDITION_OPERATORS = [
  ['is greater than or equal to', 'gte'],
  ['greater than or equal to', 'gte'],
  ['is less than or equal to', 'lte'],
  ['less than or equal to', 'lte'],
  ['does not contain', 'not_contains'],
  ['is not equal to', 'neq'],
  ['not equal to', 'neq'],
  ['starts with', 'starts_with'],
  ['is greater than', 'gt'],
  ['greater than', 'gt'],
  ['is less than', 'lt'],
  ['less than', 'lt'],
  ['is at least', 'gte'],
  ['at least', 'gte'],
  ['is at most', 'lte'],
  ['at most', 'lte'],
  ['is above', 'gt'],
  ['above', 'gt'],
  ['is over', 'gt'],
  ['over', 'gt'],
  ['is below', 'lt'],
  ['below', 'lt'],
  ['is under', 'lt'],
  ['under', 'lt'],
  ['contains', 'contains'],
  ['is not', 'neq'],
  ['equals', 'eq'],
  ['equal to', 'eq'],
  ['is', 'eq'],
];

const UNIT_ALIASES = Object.freeze({
  m: 'meter',
  meter: 'meter',
  meters: 'meter',
  metre: 'meter',
  metres: 'meter',
  km: 'kilometer',
  kilometer: 'kilometer',
  kilometers: 'kilometer',
  kilometre: 'kilometer',
  kilometres: 'kilometer',
  mi: 'mile',
  mile: 'mile',
  miles: 'mile',
  ft: 'foot',
  foot: 'foot',
  feet: 'foot',
  ha: 'hectare',
  hectare: 'hectare',
  hectares: 'hectare',
  acre: 'acre',
  acres: 'acre',
  sqm: 'square_meter',
  'square meter': 'square_meter',
  'square meters': 'square_meter',
  sqft: 'square_foot',
  'square foot': 'square_foot',
  'square feet': 'square_foot',
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function createId(prefix) {
  sequence += 1;
  return `${prefix}_${sequence.toString(36)}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function targetForLayer(layer) {
  return { kind: 'layer', layerId: layer.id };
}

function parseScalar(rawValue, field) {
  let raw = normalizeText(rawValue).replace(/^["']|["']$/g, '');
  if (/^(true|yes)$/i.test(raw)) return { value: true };
  if (/^(false|no)$/i.test(raw)) return { value: false };
  if (/^(null|none|empty)$/i.test(raw)) return { value: null };

  const numeric = raw.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (numeric) {
    const suffix = normalizeText(numeric[2]).toLowerCase();
    const unit = UNIT_ALIASES[suffix] || (suffix || field?.unit || null);
    return {
      value: Number(numeric[1]),
      ...(unit ? { unit } : {}),
    };
  }
  return { value: raw };
}

function parseDistance(value, unit) {
  const normalizedUnit = UNIT_ALIASES[normalizeText(unit).toLowerCase()];
  if (!normalizedUnit || !['meter', 'kilometer', 'mile', 'foot'].includes(normalizedUnit)) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return { value: numeric, unit: normalizedUnit };
}

function splitSegments(text) {
  const sequenceParts = normalizeText(text).split(
    /\s+(?:and\s+then|then|also|after\s+that|next)\s+/i
  );
  const operationLookahead = new RegExp(`\\s+and\\s+(?=(?:${OPERATION_START})\\b)`, 'i');
  return sequenceParts
    .flatMap((part) => part.split(operationLookahead))
    .map((part) => part.trim())
    .filter(Boolean);
}

function legacyOperation(command) {
  const map = {
    [INTENT.ZOOM_IN]: [OPERATION.VIEW_ZOOM, null, { delta: 1 }],
    [INTENT.ZOOM_OUT]: [OPERATION.VIEW_ZOOM, null, { delta: -1 }],
    [INTENT.PAN_LEFT]: [OPERATION.VIEW_PAN, null, { direction: 'left' }],
    [INTENT.PAN_RIGHT]: [OPERATION.VIEW_PAN, null, { direction: 'right' }],
    [INTENT.PAN_UP]: [OPERATION.VIEW_PAN, null, { direction: 'up' }],
    [INTENT.PAN_DOWN]: [OPERATION.VIEW_PAN, null, { direction: 'down' }],
    [INTENT.RESET_VIEW]: [OPERATION.VIEW_RESET, null, {}],
    [INTENT.ADD_MARKER]: [OPERATION.FEATURE_ADD, { kind: 'map' }, command.payload],
    [INTENT.SWITCH_MAP]: [OPERATION.ADAPTER_SWITCH, null, command.payload],
    [INTENT.UNDO]: [OPERATION.HISTORY_UNDO, null, {}],
    [INTENT.REDO]: [OPERATION.HISTORY_REDO, null, {}],
  };

  if (command.intent === INTENT.GO_TO) {
    return {
      type: OPERATION.VIEW_SET,
      target: { kind: 'place', name: command.payload.place },
      args: { center: command.payload.coords, source: command.payload.source },
      confidence: command.confidence,
    };
  }
  if (command.intent === INTENT.SHOW_LAYER || command.intent === INTENT.HIDE_LAYER) {
    return {
      type: OPERATION.LAYER_VISIBILITY,
      target: { kind: 'layer', layerId: command.payload.layerId },
      args: { visible: command.intent === INTENT.SHOW_LAYER },
      confidence: command.confidence,
    };
  }
  const mapped = map[command.intent];
  if (!mapped) return null;
  return {
    type: mapped[0],
    target: mapped[1],
    args: mapped[2],
    confidence: command.confidence,
  };
}

/**
 * Compile natural-language GIS requests into inspectable, typed operation plans.
 */
export class SpatialCommandCompiler {
  /**
   * @param {import('./types.js').CompilerOptions} [options]
   */
  constructor(options = {}) {
    this.catalog = options.catalog instanceof SpatialCatalog
      ? options.catalog
      : new SpatialCatalog(options.catalog);
    this.policy = options.policy instanceof CommandPolicy
      ? options.policy
      : new CommandPolicy(options.policy);
    this.enableGeocoding = options.enableGeocoding === true;
    this.geocoder = options.geocoder;
    this.resolvers = [...(options.resolvers || [])];
    this.clock = options.clock || Date.now;
  }

  /** @param {import('./types.js').CommandResolver} resolver */
  addResolver(resolver) {
    if (typeof resolver !== 'function') throw new TypeError('A resolver must be a function.');
    this.resolvers.push(resolver);
    return () => {
      const index = this.resolvers.indexOf(resolver);
      if (index >= 0) this.resolvers.splice(index, 1);
    };
  }

  /**
   * @param {string} input
   * @returns {Promise<import('./types.js').CommandPlan>}
   */
  async compile(input) {
    const raw = normalizeText(input);
    const operations = [];
    const issues = [];
    const planId = createId('plan');

    if (!raw) {
      issues.push({
        code: 'empty_command',
        severity: 'input',
        message: 'Enter or transcribe a GIS command.',
      });
    } else {
      for (const segment of splitSegments(raw)) {
        const result = await this._compileSegment(segment);
        for (const operation of result.operations || []) {
          operations.push(this._decorateOperation(operation, segment, operations.length, issues));
        }
        issues.push(...(result.issues || []));
      }
    }

    const blocked = issues.some((issue) => issue.severity === 'blocked');
    const needsInput = issues.some((issue) => issue.severity === 'input');
    const confirmationOperationIds = operations
      .filter((operation) => operation.requiresConfirmation)
      .map((operation) => operation.id);
    const status = blocked
      ? PLAN_STATUS.BLOCKED
      : needsInput || operations.length === 0
        ? PLAN_STATUS.NEEDS_INPUT
        : confirmationOperationIds.length > 0
          ? PLAN_STATUS.NEEDS_CONFIRMATION
          : PLAN_STATUS.READY;

    return {
      version: CORE_SCHEMA_VERSION,
      id: planId,
      input: raw,
      status,
      operations,
      issues,
      requirements: {
        capabilities: unique(operations.map((operation) => operation.type)),
        permissions: unique(operations.map((operation) => operation.permission)),
        confirmationOperationIds,
      },
      meta: {
        catalogVersion: this.catalog.version,
        createdAt: new Date(this.clock()).toISOString(),
        compiler: 'voicegis-core',
      },
    };
  }

  _decorateOperation(operation, source, index, issues) {
    const decision = this.policy.evaluate(operation);
    const decorated = {
      id: operation.id || createId('op'),
      type: operation.type,
      target: operation.target ?? null,
      args: operation.args || {},
      confidence: operation.confidence ?? 0.9,
      risk: decision.risk,
      permission: decision.permission,
      requiresConfirmation: decision.requiresConfirmation,
      source: operation.source || { text: source, segment: index },
    };

    if (!decision.allowed) {
      issues.push({
        code: 'policy_denied',
        severity: 'blocked',
        message: decision.reason,
        operationId: decorated.id,
      });
    }

    const layerId = decorated.target?.kind === 'layer' ? decorated.target.layerId : null;
    if (layerId && this.catalog.resolveLayer(layerId, { fuzzy: false })) {
      if (!this.catalog.supports(layerId, decorated.type)) {
        issues.push({
          code: 'catalog_capability_missing',
          severity: 'blocked',
          message: `Layer "${layerId}" does not declare capability "${decorated.type}".`,
          operationId: decorated.id,
        });
      }
    }
    return decorated;
  }

  async _compileSegment(segment) {
    for (const resolver of this.resolvers) {
      const result = await resolver({
        text: segment,
        catalog: this.catalog,
        policy: this.policy,
        compiler: this,
      });
      if (result) {
        if (Array.isArray(result)) return { operations: result, issues: [] };
        if ('operations' in result || 'issues' in result) {
          return {
            operations: result.operations || [],
            issues: result.issues || [],
          };
        }
        return {
          operations: result.type ? [result] : [],
          issues: [],
        };
      }
    }

    const specialized = this._compileSpatial(segment);
    if (specialized) return specialized;

    const command = await parseCommand(segment, {
      enableGeocoding: this.enableGeocoding,
      geocoder: this.geocoder,
    });
    const operation = legacyOperation(command);
    if (operation) return { operations: [operation], issues: [] };
    return {
      operations: [],
      issues: [{
        code: 'unknown_command',
        severity: 'input',
        message: `Could not map "${segment}" to a supported GIS operation.`,
        details: { segment },
      }],
    };
  }

  _compileSpatial(segment) {
    const text = normalizeText(segment);

    const spatial = text.match(
      /^select\s+(?:features\s+(?:in|from)\s+)?(.+?)\s+within\s+(\d+(?:\.\d+)?)\s*(meters?|metres?|m|kilometers?|kilometres?|km|miles?|mi|feet|foot|ft)\s+of\s+(.+)$/i
    );
    if (spatial) {
      const targetResult = this._requireLayer(spatial[1]);
      if (targetResult.issue) return { operations: [], issues: [targetResult.issue] };
      const distance = parseDistance(spatial[2], spatial[3]);
      const referenceMatch = this.catalog.resolveLayer(spatial[4]) || this.catalog.findLayer(spatial[4]);
      const reference = referenceMatch
        ? targetForLayer(referenceMatch.layer)
        : { kind: 'literal', value: normalizeText(spatial[4]) };
      return {
        operations: [{
          type: OPERATION.QUERY_SPATIAL_SELECT,
          target: targetForLayer(targetResult.layer),
          args: { relation: 'within', distance, reference },
          confidence: Math.min(targetResult.score, referenceMatch?.score || 0.82),
        }],
        issues: [],
      };
    }

    const filterLike = text.match(
      /^(filter|select|count)\s+(?:features|records)?\s*(?:in|from|on)?\s*(.+?)\s+where\s+(.+)$/i
    );
    if (filterLike) {
      const layerResult = this._requireLayer(filterLike[2]);
      if (layerResult.issue) return { operations: [], issues: [layerResult.issue] };
      const predicateResult = this._parsePredicate(filterLike[3], layerResult.layer);
      if (predicateResult.issue) return { operations: [], issues: [predicateResult.issue] };
      const operationByVerb = {
        filter: OPERATION.QUERY_FILTER,
        select: OPERATION.QUERY_SELECT,
        count: OPERATION.QUERY_COUNT,
      };
      return {
        operations: [{
          type: operationByVerb[filterLike[1].toLowerCase()],
          target: targetForLayer(layerResult.layer),
          args: { predicate: predicateResult.predicate },
          confidence: Math.min(layerResult.score, predicateResult.score),
        }],
        issues: [],
      };
    }

    const show = text.match(
      /^(show|display|enable|turn\s+on|hide|remove|disable|turn\s+off)\s+(?:the\s+)?(.+?)(?:\s+layer)?(?:\s+where\s+(.+))?$/i
    );
    if (show) {
      let layerPhrase = show[2];
      let condition = show[3] || null;
      if (!condition && /\s+where\s+/i.test(layerPhrase)) {
        [layerPhrase, condition] = layerPhrase.split(/\s+where\s+/i, 2);
      }
      const layerMatch = this.catalog.resolveLayer(layerPhrase) || this.catalog.findLayer(layerPhrase);
      if (layerMatch) {
        const visible = !/^(hide|remove|disable|turn\s+off)$/i.test(show[1]);
        /** @type {Array<object>} */
        const operations = [{
          type: OPERATION.LAYER_VISIBILITY,
          target: targetForLayer(layerMatch.layer),
          args: { visible },
          confidence: layerMatch.score,
        }];
        if (condition) {
          const predicateResult = this._parsePredicate(condition, layerMatch.layer);
          if (predicateResult.issue) return { operations, issues: [predicateResult.issue] };
          operations.push({
            type: OPERATION.QUERY_FILTER,
            target: targetForLayer(layerMatch.layer),
            args: { predicate: predicateResult.predicate },
            confidence: Math.min(layerMatch.score, predicateResult.score),
          });
        }
        return { operations, issues: [] };
      }
    }

    const clearFilter = text.match(/^clear\s+(?:the\s+)?filters?(?:\s+(?:on|from)\s+(.+))?$/i);
    if (clearFilter) {
      if (!clearFilter[1]) {
        return {
          operations: [{
            type: OPERATION.QUERY_CLEAR,
            target: { kind: 'all_layers' },
            args: {},
          }],
          issues: [],
        };
      }
      const layerResult = this._requireLayer(clearFilter[1]);
      if (layerResult.issue) return { operations: [], issues: [layerResult.issue] };
      return {
        operations: [{
          type: OPERATION.QUERY_CLEAR,
          target: targetForLayer(layerResult.layer),
          args: {},
          confidence: layerResult.score,
        }],
        issues: [],
      };
    }

    if (/^clear\s+(?:the\s+)?selection$/i.test(text)) {
      return {
        operations: [{
          type: OPERATION.SELECTION_CLEAR,
          target: { kind: 'selection' },
          args: {},
        }],
        issues: [],
      };
    }

    const buffer = text.match(
      /^buffer\s+(.+?)(?:\s+by)?\s+(\d+(?:\.\d+)?)\s*(meters?|metres?|m|kilometers?|kilometres?|km|miles?|mi|feet|foot|ft)$/i
    );
    if (buffer) {
      const distance = parseDistance(buffer[2], buffer[3]);
      const targetResult = this._resolveSelectionOrLayer(buffer[1]);
      if (targetResult.issue) return { operations: [], issues: [targetResult.issue] };
      return {
        operations: [{
          type: OPERATION.ANALYSIS_BUFFER,
          target: targetResult.target,
          args: { distance },
          confidence: targetResult.score,
        }],
        issues: [],
      };
    }

    const exportMatch = text.match(
      /^export\s+(.+?)(?:\s+(?:as|to))\s+(geojson|csv|kml|json)$/i
    );
    if (exportMatch) {
      const targetResult = this._resolveSelectionOrLayer(exportMatch[1]);
      if (targetResult.issue) return { operations: [], issues: [targetResult.issue] };
      return {
        operations: [{
          type: OPERATION.DATA_EXPORT,
          target: targetResult.target,
          args: { format: exportMatch[2].toLowerCase() },
          confidence: targetResult.score,
        }],
        issues: [],
      };
    }

    const countLayer = text.match(/^count\s+(?:features|records)?\s*(?:in|from)?\s*(.+)$/i);
    if (countLayer) {
      const layerResult = this._requireLayer(countLayer[1]);
      if (layerResult.issue) return { operations: [], issues: [layerResult.issue] };
      return {
        operations: [{
          type: OPERATION.QUERY_COUNT,
          target: targetForLayer(layerResult.layer),
          args: {},
          confidence: layerResult.score,
        }],
        issues: [],
      };
    }

    return null;
  }

  _resolveSelectionOrLayer(value) {
    if (/^(?:the\s+)?(?:selected\s+features|selection|selected)$/i.test(normalizeText(value))) {
      return { target: { kind: 'selection' }, score: 1 };
    }
    const layerResult = this._requireLayer(value);
    if (layerResult.issue) return layerResult;
    return { target: targetForLayer(layerResult.layer), score: layerResult.score };
  }

  _requireLayer(value) {
    const result = this.catalog.resolveLayer(value) || this.catalog.findLayer(value);
    if (result) return { layer: result.layer, score: result.score };
    return {
      issue: {
        code: 'unknown_layer',
        severity: 'input',
        message: `Layer "${normalizeText(value)}" is not in the spatial catalog.`,
        details: { value: normalizeText(value) },
      },
    };
  }

  _parsePredicate(expression, layer) {
    const orParts = expression.split(/\s+or\s+/i);
    if (orParts.length > 1) return this._parsePredicateGroup('or', orParts, layer);
    const andParts = expression.split(/\s+and\s+/i);
    if (andParts.length > 1) return this._parsePredicateGroup('and', andParts, layer);

    for (const [phrase, operator] of CONDITION_OPERATORS) {
      const match = normalizeText(expression).match(
        new RegExp(`^(.+?)\\s+${escapeRegExp(phrase).replaceAll('\\ ', '\\s+')}\\s+(.+)$`, 'i')
      );
      if (!match) continue;
      const fieldResult = this.catalog.resolveField(layer, match[1]);
      if (!fieldResult) {
        return {
          issue: {
            code: 'unknown_field',
            severity: 'input',
            message: `Field "${normalizeText(match[1])}" is not defined on layer "${layer.id}".`,
            details: { layerId: layer.id, field: normalizeText(match[1]) },
          },
        };
      }
      const scalar = parseScalar(match[2], fieldResult.field);
      return {
        predicate: {
          type: 'comparison',
          field: fieldResult.field.id,
          operator,
          ...scalar,
        },
        score: fieldResult.score,
      };
    }

    return {
      issue: {
        code: 'invalid_predicate',
        severity: 'input',
        message: `Could not understand the condition "${normalizeText(expression)}".`,
        details: { layerId: layer.id, expression: normalizeText(expression) },
      },
    };
  }

  _parsePredicateGroup(operator, parts, layer) {
    const conditions = [];
    let score = 1;
    for (const part of parts) {
      const result = this._parsePredicate(part, layer);
      if (result.issue) return result;
      conditions.push(result.predicate);
      score = Math.min(score, result.score);
    }
    return {
      predicate: { type: 'group', operator, conditions },
      score,
    };
  }
}

export { splitSegments as splitSpatialCommand };
