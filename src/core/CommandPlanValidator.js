import { PLAN_STATUS } from './constants.js';
import { SpatialCatalog } from './SpatialCatalog.js';
import { CORE_SCHEMA_VERSION } from './types.js';

const PLAN_STATUSES = new Set(Object.values(PLAN_STATUS));
const PREDICATE_OPERATORS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'starts_with',
]);

function createIssue(code, message, operation, details) {
  return {
    code,
    severity: 'blocked',
    message,
    ...(operation?.id ? { operationId: operation.id } : {}),
    ...(details ? { details } : {}),
  };
}

function findLayerById(catalog, layerId) {
  return catalog.layers.find((layer) => layer.id === layerId) || null;
}

function validateLayerReference(reference, catalog, issues, operation, location) {
  if (!reference || reference.kind !== 'layer') return null;
  if (typeof reference.layerId !== 'string' || !reference.layerId) {
    issues.push(createIssue(
      'catalog_layer_id_missing',
      `The ${location} does not contain a stable layer id.`,
      operation,
      { location }
    ));
    return null;
  }

  const layer = findLayerById(catalog, reference.layerId);
  if (!layer) {
    issues.push(createIssue(
      'catalog_layer_unknown',
      `Layer "${reference.layerId}" is not present in catalog "${catalog.version}".`,
      operation,
      { layerId: reference.layerId, location }
    ));
  }
  return layer;
}

function validatePredicate(predicate, layer, issues, operation, path = 'args.predicate') {
  if (!predicate || typeof predicate !== 'object') {
    issues.push(createIssue(
      'predicate_invalid',
      `The predicate at "${path}" must be an object.`,
      operation,
      { path }
    ));
    return;
  }

  if (predicate.type === 'group') {
    if (!['and', 'or'].includes(predicate.operator)) {
      issues.push(createIssue(
        'predicate_operator_invalid',
        `Predicate group operator "${predicate.operator}" is not supported.`,
        operation,
        { path, operator: predicate.operator }
      ));
    }
    if (!Array.isArray(predicate.conditions) || predicate.conditions.length === 0) {
      issues.push(createIssue(
        'predicate_group_empty',
        `The predicate group at "${path}" must contain at least one condition.`,
        operation,
        { path }
      ));
      return;
    }
    predicate.conditions.forEach((condition, index) => {
      validatePredicate(condition, layer, issues, operation, `${path}.conditions[${index}]`);
    });
    return;
  }

  if (predicate.type !== 'comparison') {
    issues.push(createIssue(
      'predicate_type_invalid',
      `Predicate type "${predicate.type}" is not supported.`,
      operation,
      { path, type: predicate.type }
    ));
    return;
  }

  if (!PREDICATE_OPERATORS.has(predicate.operator)) {
    issues.push(createIssue(
      'predicate_operator_invalid',
      `Predicate operator "${predicate.operator}" is not supported.`,
      operation,
      { path, operator: predicate.operator }
    ));
  }

  const fieldId = predicate.field;
  const field = typeof fieldId === 'string'
    ? layer.fields.find((candidate) => candidate.id === fieldId)
    : null;
  if (!field) {
    issues.push(createIssue(
      'catalog_field_unknown',
      `Field "${fieldId}" is not present on layer "${layer.id}".`,
      operation,
      { layerId: layer.id, field: fieldId, path }
    ));
  }
}

/**
 * Revalidates a command plan against the catalog trusted by the execution
 * environment. It intentionally resolves stable ids only, never labels,
 * aliases, or fuzzy matches.
 */
export class CommandPlanValidator {
  /**
   * @param {import('./types.js').CatalogDefinition|Array<import('./types.js').CatalogLayer|string>|SpatialCatalog} catalog
   * @param {import('./types.js').PlanValidationOptions} [options]
   */
  constructor(catalog, options = {}) {
    this.catalog = catalog instanceof SpatialCatalog ? catalog : new SpatialCatalog(catalog);
    this.strictCatalogVersion = options.strictCatalogVersion !== false;
  }

  /**
   * @param {import('./types.js').CommandPlan} plan
   * @returns {import('./types.js').PlanValidationResult}
   */
  validate(plan) {
    const issues = [];
    if (!plan || typeof plan !== 'object') {
      return {
        valid: false,
        issues: [createIssue('plan_invalid', 'A command plan object is required.')],
      };
    }

    if (plan.version !== CORE_SCHEMA_VERSION) {
      issues.push(createIssue(
        'plan_schema_version_mismatch',
        `Plan schema "${plan.version}" is not supported; expected "${CORE_SCHEMA_VERSION}".`,
        null,
        { actual: plan.version, expected: CORE_SCHEMA_VERSION }
      ));
    }
    if (!PLAN_STATUSES.has(plan.status)) {
      issues.push(createIssue(
        'plan_status_invalid',
        `Plan status "${plan.status}" is not supported.`,
        null,
        { status: plan.status }
      ));
    }

    if (this.strictCatalogVersion) {
      const planCatalogVersion = plan.meta?.catalogVersion;
      if (planCatalogVersion !== this.catalog.version) {
        issues.push(createIssue(
          'catalog_version_mismatch',
          `Plan catalog "${planCatalogVersion ?? 'missing'}" does not match trusted catalog "${this.catalog.version}".`,
          null,
          { actual: planCatalogVersion ?? null, expected: this.catalog.version }
        ));
      }
    }

    if (!Array.isArray(plan.operations)) {
      issues.push(createIssue('plan_operations_invalid', 'Plan operations must be an array.'));
      return { valid: false, issues };
    }

    const operationIds = new Set();
    for (const operation of plan.operations) {
      if (!operation || typeof operation !== 'object') {
        issues.push(createIssue('operation_invalid', 'Every plan operation must be an object.'));
        continue;
      }
      if (typeof operation.id !== 'string' || !operation.id) {
        issues.push(createIssue(
          'operation_id_missing',
          'Every operation must contain a stable id.',
          operation
        ));
      } else if (operationIds.has(operation.id)) {
        issues.push(createIssue(
          'operation_id_duplicate',
          `Operation id "${operation.id}" occurs more than once.`,
          operation,
          { operationId: operation.id }
        ));
      } else {
        operationIds.add(operation.id);
      }
      if (typeof operation.type !== 'string' || !operation.type) {
        issues.push(createIssue(
          'operation_type_missing',
          'Every operation must contain a type.',
          operation
        ));
        continue;
      }

      const targetLayer = validateLayerReference(
        operation.target,
        this.catalog,
        issues,
        operation,
        'operation target'
      );
      validateLayerReference(
        operation.args?.reference,
        this.catalog,
        issues,
        operation,
        'spatial reference'
      );

      if (targetLayer && !this.catalog.supports(targetLayer, operation.type)) {
        issues.push(createIssue(
          'catalog_capability_missing',
          `Layer "${targetLayer.id}" does not declare capability "${operation.type}".`,
          operation,
          { layerId: targetLayer.id, capability: operation.type }
        ));
      }

      if (operation.args?.predicate !== undefined) {
        if (!targetLayer) {
          issues.push(createIssue(
            'predicate_layer_missing',
            'A query predicate must target a catalog layer.',
            operation
          ));
        } else {
          validatePredicate(operation.args.predicate, targetLayer, issues, operation);
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }
}

/**
 * @param {import('./types.js').CommandPlan} plan
 * @param {import('./types.js').CatalogDefinition|Array<import('./types.js').CatalogLayer|string>|SpatialCatalog} catalog
 * @param {import('./types.js').PlanValidationOptions} [options]
 * @returns {import('./types.js').PlanValidationResult}
 */
export function validateCommandPlan(plan, catalog, options) {
  return new CommandPlanValidator(catalog, options).validate(plan);
}
