/**
 * Public schema types for VoiceGIS Core.
 *
 * This module intentionally has almost no runtime surface. Its JSDoc types are
 * used to generate the declarations shipped with the package.
 */

export const CORE_SCHEMA_VERSION = '1.0';

/**
 * @typedef {'ready'|'needs_input'|'needs_confirmation'|'blocked'} PlanStatus
 */

/**
 * @typedef {'low'|'medium'|'high'} RiskLevel
 */

/**
 * @typedef {'view'|'query'|'edit'|'analysis'|'export'|'location'|'admin'} Permission
 */

/**
 * @typedef {object} Distance
 * @property {number} value
 * @property {'meter'|'kilometer'|'mile'|'foot'|string} unit
 */

/**
 * @typedef {object} ComparisonPredicate
 * @property {'comparison'} type
 * @property {string} field
 * @property {'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'contains'|'not_contains'|'starts_with'} operator
 * @property {string|number|boolean|null} value
 * @property {string} [unit]
 */

/**
 * @typedef {object} PredicateGroup
 * @property {'group'} type
 * @property {'and'|'or'} operator
 * @property {SpatialPredicate[]} conditions
 */

/**
 * @typedef {ComparisonPredicate|PredicateGroup} SpatialPredicate
 */

/**
 * @typedef {object} SpatialTarget
 * @property {string} kind
 * @property {string} [layerId]
 * @property {string} [name]
 * @property {string} [id]
 * @property {*} [value]
 */

/**
 * @typedef {object} SourceReference
 * @property {string} text
 * @property {number} segment
 */

/**
 * @typedef {object} SpatialOperation
 * @property {string} id
 * @property {string} type
 * @property {SpatialTarget|null} target
 * @property {Record<string, *>} args
 * @property {number} confidence
 * @property {RiskLevel} risk
 * @property {Permission|null} permission
 * @property {boolean} requiresConfirmation
 * @property {SourceReference} source
 */

/**
 * @typedef {object} PlanIssue
 * @property {string} code
 * @property {'input'|'blocked'|'warning'|string} severity
 * @property {string} message
 * @property {string} [operationId]
 * @property {Record<string, *>} [details]
 */

/**
 * @typedef {object} PlanRequirements
 * @property {string[]} capabilities
 * @property {string[]} permissions
 * @property {string[]} confirmationOperationIds
 */

/**
 * @typedef {object} CommandPlan
 * @property {string} version
 * @property {string} id
 * @property {string} input
 * @property {PlanStatus} status
 * @property {SpatialOperation[]} operations
 * @property {PlanIssue[]} issues
 * @property {PlanRequirements} requirements
 * @property {{catalogVersion:string, createdAt:string, compiler:string}} meta
 */

/**
 * @typedef {object} ExecutionError
 * @property {string} [name]
 * @property {string} message
 * @property {PlanIssue[]} [issues]
 */

/**
 * @typedef {object} OperationResult
 * @property {string} [operationId]
 * @property {string} [type]
 * @property {'succeeded'|'failed'|'cancelled'|'needs_confirmation'} status
 * @property {*} [value]
 * @property {ExecutionError} [error]
 */

/**
 * @typedef {object} ExecutionReceipt
 * @property {string|null} planId
 * @property {'succeeded'|'partial'|'failed'|'cancelled'|'needs_confirmation'} status
 * @property {string} startedAt
 * @property {string|null} completedAt
 * @property {OperationResult[]} results
 */

/**
 * @typedef {object} ExecutionContext
 * @property {CommandPlan} plan
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} FunctionAdapterHandlerPayload
 * @property {SpatialOperation} operation
 * @property {SpatialTarget|null} target
 * @property {Record<string, *>} args
 * @property {ExecutionContext|Record<string, *>} context
 */

/**
 * @callback FunctionAdapterHandler
 * @param {FunctionAdapterHandlerPayload} payload
 * @returns {*|Promise<*>}
 */

/**
 * @typedef {object} VoiceGISAdapter
 * @property {string} [name]
 * @property {readonly string[]} [capabilities]
 * @property {(type:string) => boolean} supports
 * @property {(operation:SpatialOperation, context?:ExecutionContext|Record<string, *>) => Promise<*>} execute
 */

/**
 * @typedef {object} CatalogField
 * @property {string} id
 * @property {string} [label]
 * @property {string[]} [aliases]
 * @property {'string'|'number'|'boolean'|'date'|string} [type]
 * @property {string} [unit]
 */

/**
 * @typedef {object} CatalogLayer
 * @property {string} id
 * @property {string} [label]
 * @property {string[]} [aliases]
 * @property {CatalogField[]|Record<string, Omit<CatalogField, 'id'>>} [fields]
 * @property {string[]} [capabilities]
 */

/**
 * @typedef {object} CatalogDefinition
 * @property {string} [version]
 * @property {Array<CatalogLayer|string>|Record<string, Omit<CatalogLayer, 'id'>>} [layers]
 */

/**
 * @typedef {object} CommandPolicyOptions
 * @property {Permission[]} [permissions]
 * @property {string[]} [allow]
 * @property {string[]} [deny]
 * @property {string[]} [confirm]
 */

/**
 * @typedef {object} PolicyDecision
 * @property {boolean} allowed
 * @property {Permission|null} permission
 * @property {RiskLevel} risk
 * @property {boolean} requiresConfirmation
 * @property {string|null} reason
 */

/**
 * Application-defined policy contract. This makes custom operation types
 * possible without weakening the built-in policy's safe defaults.
 *
 * @typedef {object} PolicyEvaluator
 * @property {(operation:string|{type:string}) => PolicyDecision} evaluate
 */

/**
 * @typedef {object} ResolverContext
 * @property {string} text
 * @property {import('./SpatialCatalog.js').SpatialCatalog} catalog
 * @property {PolicyEvaluator} policy
 * @property {import('./SpatialCommandCompiler.js').SpatialCommandCompiler} compiler
 */

/**
 * @typedef {object} ResolverResult
 * @property {Array<Partial<SpatialOperation>>} [operations]
 * @property {PlanIssue[]} [issues]
 * @property {string} [type]
 * @property {SpatialTarget|null} [target]
 * @property {Record<string, *>} [args]
 */

/**
 * @callback CommandResolver
 * @param {ResolverContext} context
 * @returns {null|Partial<SpatialOperation>|Array<Partial<SpatialOperation>>|ResolverResult|Promise<null|Partial<SpatialOperation>|Array<Partial<SpatialOperation>>|ResolverResult>}
 */

/**
 * @typedef {object} CompilerOptions
 * @property {import('./SpatialCatalog.js').SpatialCatalog|CatalogDefinition|Array<CatalogLayer|string>} [catalog]
 * @property {PolicyEvaluator|CommandPolicyOptions} [policy]
 * @property {boolean} [enableGeocoding]
 * @property {{geocode:(place:string) => Promise<*>}} [geocoder]
 * @property {CommandResolver[]} [resolvers]
 * @property {() => number} [clock]
 */

/**
 * @typedef {object} ExecutorOptions
 * @property {VoiceGISAdapter} [adapter]
 * @property {PolicyEvaluator|CommandPolicyOptions} [policy]
 * @property {import('./SpatialCatalog.js').SpatialCatalog|CatalogDefinition|Array<CatalogLayer|string>} [catalog]
 * @property {boolean} [strictCatalogVersion]
 * @property {() => number} [clock]
 */

/**
 * @typedef {object} PlanValidationOptions
 * @property {boolean} [strictCatalogVersion]
 */

/**
 * @typedef {object} PlanValidationResult
 * @property {boolean} valid
 * @property {PlanIssue[]} issues
 */

/**
 * @typedef {object} ExecuteOptions
 * @property {boolean|((operation:SpatialOperation, plan:CommandPlan) => boolean|Promise<boolean>)} [confirm]
 * @property {AbortSignal} [signal]
 * @property {boolean} [stopOnError]
 * @property {(event:Record<string, *>) => void} [onEvent]
 */

/**
 * @typedef {CompilerOptions & {adapter?: VoiceGISAdapter, strictCatalogVersion?: boolean}} VoiceGISCoreOptions
 */
