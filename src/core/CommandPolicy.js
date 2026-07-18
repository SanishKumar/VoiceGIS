import { OPERATION_METADATA, PERMISSION } from './constants.js';

function matchesPattern(value, pattern) {
  if (pattern === '*' || pattern === value) return true;
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return false;
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => matchesPattern(value, pattern));
}

/**
 * Defines which command classes may run and which ones require human approval.
 */
export class CommandPolicy {
  /**
   * @param {import('./types.js').CommandPolicyOptions} [options]
   */
  constructor(options = {}) {
    this.permissions = new Set(options.permissions || [PERMISSION.VIEW, PERMISSION.QUERY]);
    this.allow = Object.freeze([...(options.allow || [])]);
    this.deny = Object.freeze([...(options.deny || [])]);
    this.confirm = Object.freeze(
      options.confirm || Object.entries(OPERATION_METADATA)
        .filter(([, metadata]) => 'confirmByDefault' in metadata && metadata.confirmByDefault)
        .map(([type]) => type)
    );
  }

  /**
   * Evaluate an operation without executing it.
   * @param {string|{type:string}} operation
   * @returns {import('./types.js').PolicyDecision}
   */
  evaluate(operation) {
    const type = typeof operation === 'string' ? operation : operation?.type;
    const metadata = OPERATION_METADATA[type];
    if (!type || !metadata) {
      return {
        allowed: false,
        permission: null,
        risk: 'high',
        requiresConfirmation: false,
        reason: `Unknown operation "${type || ''}".`,
      };
    }

    let reason = null;
    if (matchesAny(type, this.deny)) {
      reason = `Operation "${type}" is denied by policy.`;
    } else if (this.allow.length > 0 && !matchesAny(type, this.allow)) {
      reason = `Operation "${type}" is not in the policy allow list.`;
    } else if (!this.permissions.has(metadata.permission)) {
      reason = `Permission "${metadata.permission}" is required for "${type}".`;
    }

    return {
      allowed: reason === null,
      permission: metadata.permission,
      risk: metadata.risk,
      requiresConfirmation: matchesAny(type, this.confirm),
      reason,
    };
  }

  static permissive(options = {}) {
    return new CommandPolicy({
      permissions: Object.values(PERMISSION),
      confirm: options.confirm || [],
      allow: options.allow,
      deny: options.deny,
    });
  }
}
