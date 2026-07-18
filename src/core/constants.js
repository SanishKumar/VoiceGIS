/**
 * Stable operation names emitted by VoiceGIS Core.
 *
 * Adapters use these values as capability and handler identifiers.
 */
export const OPERATION = Object.freeze({
  VIEW_ZOOM: 'view.zoom',
  VIEW_PAN: 'view.pan',
  VIEW_SET: 'view.set',
  VIEW_RESET: 'view.reset',
  LAYER_VISIBILITY: 'layer.visibility',
  FEATURE_ADD: 'feature.add',
  QUERY_FILTER: 'query.filter',
  QUERY_CLEAR: 'query.clear',
  QUERY_SELECT: 'query.select',
  QUERY_SPATIAL_SELECT: 'query.spatial_select',
  QUERY_COUNT: 'query.count',
  SELECTION_CLEAR: 'selection.clear',
  ANALYSIS_BUFFER: 'analysis.buffer',
  DATA_EXPORT: 'data.export',
  HISTORY_UNDO: 'history.undo',
  HISTORY_REDO: 'history.redo',
  ADAPTER_SWITCH: 'adapter.switch',
});

export const PLAN_STATUS = Object.freeze({
  READY: 'ready',
  NEEDS_INPUT: 'needs_input',
  NEEDS_CONFIRMATION: 'needs_confirmation',
  BLOCKED: 'blocked',
});

export const RISK = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

export const PERMISSION = Object.freeze({
  VIEW: 'view',
  QUERY: 'query',
  EDIT: 'edit',
  ANALYSIS: 'analysis',
  EXPORT: 'export',
  LOCATION: 'location',
  ADMIN: 'admin',
});

/**
 * Security and UX defaults for each operation. Applications can make a policy
 * stricter, but these values give every compiled command useful metadata.
 */
export const OPERATION_METADATA = Object.freeze({
  [OPERATION.VIEW_ZOOM]: { permission: PERMISSION.VIEW, risk: RISK.LOW },
  [OPERATION.VIEW_PAN]: { permission: PERMISSION.VIEW, risk: RISK.LOW },
  [OPERATION.VIEW_SET]: { permission: PERMISSION.VIEW, risk: RISK.LOW },
  [OPERATION.VIEW_RESET]: { permission: PERMISSION.VIEW, risk: RISK.LOW },
  [OPERATION.LAYER_VISIBILITY]: { permission: PERMISSION.VIEW, risk: RISK.LOW },
  [OPERATION.FEATURE_ADD]: {
    permission: PERMISSION.EDIT,
    risk: RISK.MEDIUM,
    confirmByDefault: true,
  },
  [OPERATION.QUERY_FILTER]: { permission: PERMISSION.QUERY, risk: RISK.LOW },
  [OPERATION.QUERY_CLEAR]: { permission: PERMISSION.QUERY, risk: RISK.LOW },
  [OPERATION.QUERY_SELECT]: { permission: PERMISSION.QUERY, risk: RISK.LOW },
  [OPERATION.QUERY_SPATIAL_SELECT]: {
    permission: PERMISSION.QUERY,
    risk: RISK.MEDIUM,
  },
  [OPERATION.QUERY_COUNT]: { permission: PERMISSION.QUERY, risk: RISK.LOW },
  [OPERATION.SELECTION_CLEAR]: { permission: PERMISSION.QUERY, risk: RISK.LOW },
  [OPERATION.ANALYSIS_BUFFER]: {
    permission: PERMISSION.ANALYSIS,
    risk: RISK.MEDIUM,
    confirmByDefault: true,
  },
  [OPERATION.DATA_EXPORT]: {
    permission: PERMISSION.EXPORT,
    risk: RISK.HIGH,
    confirmByDefault: true,
  },
  [OPERATION.HISTORY_UNDO]: { permission: PERMISSION.EDIT, risk: RISK.MEDIUM },
  [OPERATION.HISTORY_REDO]: { permission: PERMISSION.EDIT, risk: RISK.MEDIUM },
  [OPERATION.ADAPTER_SWITCH]: {
    permission: PERMISSION.ADMIN,
    risk: RISK.HIGH,
    confirmByDefault: true,
  },
});
