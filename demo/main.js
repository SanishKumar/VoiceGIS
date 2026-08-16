/**
 * VoiceGIS demo.
 *
 * Live USGS earthquake data, compiled from natural language into a typed,
 * policy-checked plan, then executed by the GeoJSON adapter. Nothing here is
 * simulated: the counts on screen come from evaluating the compiled predicate
 * against the features the map is drawing.
 *
 * Rendering rule for this file: every string that can contain user input —
 * issue messages, operation descriptions, predicate values, adapter errors —
 * reaches the page through `textContent`, never through markup. A command is
 * data, not a template.
 */

import { inject } from '@vercel/analytics';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  OPERATION,
  PERMISSION,
  PLAN_STATUS,
  createFunctionAdapter,
  createPlaceResolver,
  createVoiceGISCore,
} from '../src/core/index.js';
import { composeAdapters, createGeoJSONAdapter } from '../src/adapters/index.js';
import { WebSpeechEngine } from '../src/engines/WebSpeechEngine.js';
import { CATALOG, EXAMPLES } from './catalog.js';
import CITIES from './data/cities.json';
import GAZETTEER from './data/places.json';
import FALLBACK_QUAKES from './data/earthquakes-fallback.json';

if (window.location.hostname.endsWith('.vercel.app')) inject();

const USGS_FEED =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson';

const $ = (id) => document.getElementById(id);

const PERMISSION_LABELS = [
  [PERMISSION.VIEW, 'view'],
  [PERMISSION.QUERY, 'query'],
  [PERMISSION.ANALYSIS, 'analysis'],
  [PERMISSION.EXPORT, 'export'],
];

const OPERATION_TITLES = {
  [OPERATION.LAYER_VISIBILITY]: 'Layer visibility',
  [OPERATION.QUERY_FILTER]: 'Filter features',
  [OPERATION.QUERY_SELECT]: 'Select features',
  [OPERATION.QUERY_SPATIAL_SELECT]: 'Select by proximity',
  [OPERATION.QUERY_COUNT]: 'Count features',
  [OPERATION.QUERY_CLEAR]: 'Clear filters',
  [OPERATION.SELECTION_CLEAR]: 'Clear selection',
  [OPERATION.ANALYSIS_BUFFER]: 'Buffer',
  [OPERATION.DATA_EXPORT]: 'Export',
  [OPERATION.VIEW_ZOOM]: 'Zoom',
  [OPERATION.VIEW_PAN]: 'Pan',
  [OPERATION.VIEW_SET]: 'Move view',
  [OPERATION.VIEW_RESET]: 'Reset view',
};

const OPERATOR_TEXT = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
};

// A pale basemap washes out low-contrast marks, so every state carries a
// stroke and enough fill to read as data rather than as map texture.
const MARKER_STYLES = {
  base: { color: '#475569', fillColor: '#94a3b8', weight: 0.9, opacity: 0.85, fillOpacity: 0.5 },
  match: { color: '#9a3412', fillColor: '#f97316', weight: 1.2, opacity: 1, fillOpacity: 0.72 },
  selected: { color: '#0f766e', fillColor: '#14b8a6', weight: 1.6, opacity: 1, fillOpacity: 0.85 },
  dimmed: { color: '#cbd5e1', fillColor: '#e2e8f0', weight: 0.5, opacity: 0.5, fillOpacity: 0.2 },
};

const STAGES = ['compile', 'ground', 'authorize', 'execute'];

/**
 * Which pipeline stage an issue belongs to.
 *
 * The stage is a claim about *where* a request stopped, so it has to follow
 * the issue code rather than a guess: a word the compiler could not parse is
 * not the same failure as a field that is missing from the catalog, and
 * neither is the same as a permission the user does not hold.
 */
const STAGE_BY_ISSUE_CODE = {
  // Compile: the text could not be turned into an operation at all.
  unknown_command: 'compile',
  invalid_predicate: 'compile',
  empty_command: 'compile',
  // Ground: it parsed, but it names something the catalog does not contain.
  unknown_layer: 'ground',
  unknown_field: 'ground',
  unknown_place: 'ground',
  catalog_capability_missing: 'ground',
  catalog_layer_unknown: 'ground',
  catalog_field_unknown: 'ground',
  catalog_version_mismatch: 'ground',
  // Authorize: it is a real operation on real data, but not permitted.
  policy_denied: 'authorize',
};

/* ------------------------------------------------------------------ state */

const state = {
  map: null,
  quakeLayer: null,
  cityLayer: null,
  bufferLayer: null,
  markers: new Map(),
  cityMarkers: new Map(),
  permissions: new Set([PERMISSION.VIEW, PERMISSION.QUERY, PERMISSION.ANALYSIS, PERMISSION.EXPORT]),
  data: null,
  core: null,
  speech: null,
  busy: false,
};

/* --------------------------------------------------------- DOM primitives */

/**
 * Create an element, assigning any text through `textContent`.
 *
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/** Replace an element's children with newly built nodes. */
function replaceChildren(node, ...children) {
  node.replaceChildren(...children.filter(Boolean));
  return node;
}

/* ------------------------------------------------------------- formatting */

const formatNumber = (value) => Number(value).toLocaleString('en-US');

function layerLabel(layerId) {
  return CATALOG.layers.find((layer) => layer.id === layerId)?.label || layerId;
}

function fieldLabel(layerId, fieldId) {
  const layer = CATALOG.layers.find((candidate) => candidate.id === layerId);
  return layer?.fields.find((field) => field.id === fieldId)?.label || fieldId;
}

/** Render a typed predicate using catalog labels, so grounding is visible. */
function describePredicate(predicate, layerId) {
  if (!predicate) return '';
  if (predicate.type === 'group') {
    const joiner = predicate.operator === 'or' ? ' OR ' : ' AND ';
    return predicate.conditions
      .map((condition) => {
        const text = describePredicate(condition, layerId);
        return condition.type === 'group' ? `(${text})` : text;
      })
      .join(joiner);
  }

  const operator = OPERATOR_TEXT[predicate.operator] || predicate.operator;
  const value = typeof predicate.value === 'string'
    ? `"${predicate.value}"`
    : String(predicate.value);
  const unit = predicate.unit ? ` ${predicate.unit}` : '';
  return `${fieldLabel(layerId, predicate.field)} ${operator} ${value}${unit}`;
}

function describeTarget(target) {
  if (!target) return '';
  if (target.kind === 'layer') return layerLabel(target.layerId);
  if (target.kind === 'selection') return 'current selection';
  if (target.kind === 'all_layers') return 'all layers';
  if (target.kind === 'place') return target.name;
  return target.kind;
}

/** The human-readable line under an operation title. */
function describeOperation(operation) {
  const { type, target, args = {} } = operation;
  const layerId = target?.layerId;

  switch (type) {
    case OPERATION.LAYER_VISIBILITY:
      return `${args.visible ? 'show' : 'hide'} ${describeTarget(target)}`;
    case OPERATION.QUERY_FILTER:
    case OPERATION.QUERY_SELECT:
      return `${describeTarget(target)} where ${describePredicate(args.predicate, layerId)}`;
    case OPERATION.QUERY_COUNT:
      return args.predicate
        ? `${describeTarget(target)} where ${describePredicate(args.predicate, layerId)}`
        : describeTarget(target);
    case OPERATION.QUERY_SPATIAL_SELECT:
      return `${describeTarget(target)} within ${args.distance.value} ${args.distance.unit} of `
        + `${describeTarget(args.reference) || args.reference?.value}`;
    case OPERATION.QUERY_CLEAR:
      return describeTarget(target);
    case OPERATION.ANALYSIS_BUFFER:
      return `${describeTarget(target)} by ${args.distance.value} ${args.distance.unit}`;
    case OPERATION.DATA_EXPORT:
      return `${describeTarget(target)} as ${args.format}`;
    case OPERATION.VIEW_ZOOM:
      return args.delta > 0 ? 'in' : 'out';
    case OPERATION.VIEW_PAN:
      return args.direction;
    case OPERATION.VIEW_SET:
      if (args.bounds) return `frame ${describeTarget(target)} (bounds)`;
      if (args.center) {
        return `centre on ${describeTarget(target)} `
          + `(${args.center[0].toFixed(3)}, ${args.center[1].toFixed(3)})`;
      }
      return describeTarget(target);
    default:
      return describeTarget(target);
  }
}

/** Turn an adapter return value into one readable sentence. */
function describeResult(result) {
  const value = result.value;
  if (value === null || value === undefined) return 'done';

  switch (result.type) {
    case OPERATION.QUERY_FILTER:
      return `${formatNumber(value.matched)} of ${formatNumber(value.total)} features match`;
    case OPERATION.QUERY_SELECT:
      return `${formatNumber(value.selected)} features selected`;
    case OPERATION.QUERY_SPATIAL_SELECT:
      return `${formatNumber(value.selected)} selected, measured against `
        + `${formatNumber(value.evaluated)}${value.scope === 'filtered' ? ' filtered' : ''} features`;
    case OPERATION.QUERY_COUNT:
      return `${formatNumber(value.count)} features`;
    case OPERATION.QUERY_CLEAR:
      return `cleared on ${value.cleared.map(layerLabel).join(', ')}`;
    case OPERATION.SELECTION_CLEAR:
      return `${formatNumber(value.cleared)} features deselected`;
    case OPERATION.LAYER_VISIBILITY:
      return `${layerLabel(value.layerId)} ${value.visible ? 'shown' : 'hidden'}`;
    case OPERATION.ANALYSIS_BUFFER:
      return `${formatNumber(value.featureCount)} buffers at ${formatNumber(value.distance.meters)} m`;
    case OPERATION.DATA_EXPORT:
      return `${formatNumber(value.featureCount)} features → ${value.filename}`;
    case OPERATION.VIEW_SET:
      return value?.bounds ? 'framed' : 'centred';
    default:
      return 'done';
  }
}

/* ------------------------------------------------------------------- data */

/**
 * USGS keeps depth in the third geometry ordinate. Promoting it to a property
 * is the kind of normalization every host does before exposing a catalog.
 */
function normalizeQuakes(collection) {
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        depth_km: feature.geometry?.coordinates?.[2] ?? null,
      },
    })),
  };
}

async function loadEarthquakes() {
  try {
    const response = await fetch(USGS_FEED, { cache: 'no-store' });
    if (!response.ok) throw new Error(`USGS responded ${response.status}`);
    const body = await response.json();
    return { data: normalizeQuakes(body), live: true, generated: body.metadata?.generated };
  } catch (error) {
    console.warn('[VoiceGIS demo] live feed unavailable, using bundled sample:', error.message);
    return { data: normalizeQuakes(FALLBACK_QUAKES), live: false };
  }
}

/* -------------------------------------------------------------------- map */

const WORLD_BOUNDS = [[-70, -175], [78, 175]];

function initMap() {
  const map = L.map('map', {
    preferCanvas: true,
    zoomControl: true,
    attributionControl: true,
    maxBounds: [[-85, -180], [85, 180]],
    maxBoundsViscosity: 1,
    // Fractional zoom. With the default whole-number snap, the world-fit zoom
    // rounds up a full level — doubling the scale and cropping half the
    // Pacific out of the opening view. The +/- buttons still step by one.
    zoomSnap: 0,
    zoomDelta: 1,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; '
      + '<a href="https://carto.com/attributions">CARTO</a> · earthquakes: '
      + '<a href="https://earthquake.usgs.gov/earthquakes/feed/">USGS</a>',
    subdomains: 'abcd',
    maxZoom: 19,
    // A single world: repeated copies make a global result set look broken.
    noWrap: true,
  }).addTo(map);

  state.bufferLayer = L.layerGroup().addTo(map);
  state.quakeLayer = L.layerGroup().addTo(map);
  state.cityLayer = L.layerGroup().addTo(map);
  state.map = map;

  showWholeWorld();

  // A phone-width viewport cannot show the world at a zoom that suits a
  // desktop one, so derive the floor from the viewport instead of fixing it.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      map.invalidateSize();
      if (map.getZoom() <= map.getMinZoom()) showWholeWorld();
      else map.setMinZoom(worldZooms().contain);
    }, 180);
  });
}

/**
 * Two useful zooms for the world at the current viewport size.
 *
 * `contain` shows every longitude but letterboxes a portrait viewport with
 * dead space; `cover` fills the panel and crops instead. The map opens at
 * `cover` so it never looks broken, and the floor stays at `contain` so a
 * phone user can still zoom out to the whole world.
 */
function worldZooms() {
  state.map.setMinZoom(0);
  return {
    contain: state.map.getBoundsZoom(WORLD_BOUNDS, false),
    cover: state.map.getBoundsZoom(WORLD_BOUNDS, true),
  };
}

function showWholeWorld({ animate = false } = {}) {
  const { contain, cover } = worldZooms();
  state.map.setMinZoom(contain);
  state.map.setView(L.latLngBounds(WORLD_BOUNDS).getCenter(), cover, { animate });
}

const magnitudeRadius = (mag) => Math.max(2.2, ((Number(mag) || 2.5) - 1) * 1.55);

/** Popups are built as DOM: feed values are data, not markup. */
function popupNode(title, rows) {
  const wrapper = document.createDocumentFragment();
  wrapper.appendChild(el('div', 'popup-title', title));
  const grid = el('div', 'popup-grid');
  for (const [key, value] of rows) {
    grid.appendChild(el('span', null, key));
    grid.appendChild(el('b', null, value));
  }
  wrapper.appendChild(grid);
  const host = el('div');
  host.appendChild(wrapper);
  return host;
}

function quakePopup(feature) {
  const p = feature.properties;
  return popupNode(p.place || 'Earthquake', [
    ['magnitude', `${p.mag} ${p.magType || ''}`.trim()],
    ['depth', p.depth_km === null ? '—' : `${Number(p.depth_km).toFixed(1)} km`],
    ['alert', p.alert || '—'],
    ['significance', p.sig ?? '—'],
    ['felt reports', p.felt ?? '—'],
    ['time', p.time ? `${new Date(p.time).toISOString().replace('T', ' ').slice(0, 16)} UTC` : '—'],
  ]);
}

function buildQuakeMarkers(collection) {
  state.quakeLayer.clearLayers();
  state.markers.clear();

  for (const feature of collection.features) {
    const [lon, lat] = feature.geometry.coordinates;
    const marker = L.circleMarker([lat, lon], {
      radius: magnitudeRadius(feature.properties.mag),
      ...MARKER_STYLES.base,
    });
    marker.bindPopup(() => quakePopup(feature));
    marker.addTo(state.quakeLayer);
    state.markers.set(String(feature.id), marker);
  }
}

function buildCityMarkers(collection) {
  state.cityLayer.clearLayers();
  state.cityMarkers.clear();

  for (const feature of collection.features) {
    const [lon, lat] = feature.geometry.coordinates;
    const marker = L.circleMarker([lat, lon], {
      radius: 3.4,
      color: '#1c1917',
      fillColor: '#292524',
      weight: 1,
      opacity: 0.9,
      fillOpacity: 0.9,
    });
    marker.bindPopup(() => popupNode(feature.properties.name, [
      ['country', feature.properties.country],
      ['population', formatNumber(feature.properties.population)],
    ]));
    marker.addTo(state.cityLayer);
    state.cityMarkers.set(String(feature.id), marker);
  }
}

/** Repaint markers from adapter state. */
function renderMap(adapterState) {
  const quakes = adapterState.layers.earthquakes;
  const cities = adapterState.layers.cities;
  const selected = new Set(adapterState.selection.earthquakes || []);
  const hasFilter = Boolean(quakes?.filter);

  const matched = new Set(
    hasFilter
      ? state.data.getFeatures('earthquakes').map((feature) => String(feature.id))
      : []
  );

  for (const [id, marker] of state.markers) {
    let style;
    if (selected.has(id)) style = MARKER_STYLES.selected;
    else if (hasFilter) style = matched.has(id) ? MARKER_STYLES.match : MARKER_STYLES.dimmed;
    else style = MARKER_STYLES.base;

    // Only touch the canvas when a marker's appearance actually changed.
    if (marker._vgStyle !== style) {
      marker.setStyle(style);
      marker._vgStyle = style;
    }
  }

  if (quakes?.visible === false) state.map.removeLayer(state.quakeLayer);
  else if (!state.map.hasLayer(state.quakeLayer)) state.quakeLayer.addTo(state.map);

  if (cities?.visible === false) state.map.removeLayer(state.cityLayer);
  else if (!state.map.hasLayer(state.cityLayer)) state.cityLayer.addTo(state.map);

  state.bufferLayer.clearLayers();
  if (adapterState.buffers) {
    L.geoJSON(adapterState.buffers, {
      style: { color: '#0f766e', weight: 1, opacity: 0.7, fillColor: '#14b8a6', fillOpacity: 0.12 },
    }).addTo(state.bufferLayer);
  }

  renderStats(adapterState, matched.size, hasFilter);
}

function renderStats(adapterState, matchedCount, hasFilter) {
  const quakes = adapterState.layers.earthquakes;
  const selectedCount = (adapterState.selection.earthquakes || []).length;

  $('stat-shown').textContent = formatNumber(hasFilter ? matchedCount : quakes.total);
  $('stat-shown-note').textContent = hasFilter
    ? `of ${formatNumber(quakes.total)} match the filter`
    : `of ${formatNumber(quakes.total)} earthquakes`;

  $('stat-selected').textContent = formatNumber(selectedCount);
  $('stat-selected-note').textContent = selectedCount === 0
    ? 'no selection'
    : 'ready to buffer or export';
}

/**
 * Frame the map on the last result — but only when that actually helps.
 *
 * A regional answer ("place contains japan") is worth flying to. A globally
 * scattered one is not: fitting it just zooms back out to the whole world,
 * which moves the map without telling the user anything.
 */
function fitToResult(features) {
  const points = features
    .filter((feature) => feature.geometry?.coordinates)
    .map((feature) => [feature.geometry.coordinates[1], feature.geometry.coordinates[0]]);
  if (points.length === 0) return;

  const bounds = L.latLngBounds(points);
  if (!bounds.isValid()) return;

  const spanLon = bounds.getEast() - bounds.getWest();
  const spanLat = bounds.getNorth() - bounds.getSouth();
  if (spanLon > 90 || spanLat > 60) return;

  state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 7, animate: true });
}

/* ---------------------------------------------------------------- panels */

function renderCatalog(counts) {
  const host = $('catalog');
  const nodes = CATALOG.layers.map((layer) => {
    const wrapper = el('div', 'cat-layer');

    const head = el('div', 'cat-head');
    head.appendChild(el('strong', null, layer.label));
    head.appendChild(el('span', 'cat-count', `${formatNumber(counts[layer.id] ?? 0)} features`));
    wrapper.appendChild(head);

    const aliases = el('div', 'cat-aliases', 'also: ');
    for (const alias of layer.aliases.slice(0, 4)) {
      aliases.appendChild(el('code', null, alias));
    }
    wrapper.appendChild(aliases);

    const fields = el('div', 'cat-fields');
    for (const field of layer.fields) {
      const chip = el('span', 'cat-field', field.unit ? `${field.label} (${field.unit})` : field.label);
      chip.title = field.id;
      chip.appendChild(el('em', null, field.type));
      fields.appendChild(chip);
    }
    wrapper.appendChild(fields);
    return wrapper;
  });

  replaceChildren(host, ...nodes);
}

function renderPlaces() {
  const host = $('places');
  const nodes = GAZETTEER.places.slice(0, 24).map((place) => {
    const chip = el('span', 'place-chip', place.name);
    chip.dataset.kind = place.kind;
    return chip;
  });
  const more = GAZETTEER.places.length - nodes.length;
  if (more > 0) nodes.push(el('span', 'place-more', `+${more} more`));
  replaceChildren(host, ...nodes);
}

function renderPermissions() {
  const host = $('permissions');
  const nodes = PERMISSION_LABELS.map(([value, label]) => {
    const wrapper = el('label', 'perm');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.checked = state.permissions.has(value);
    wrapper.appendChild(input);
    wrapper.appendChild(el('span', null, label));
    return wrapper;
  });
  replaceChildren(host, ...nodes);

  host.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.checked) state.permissions.add(input.value);
    else state.permissions.delete(input.value);
    buildCore();
    toast(`Policy: ${[...state.permissions].join(', ') || 'no permissions'}`);
  });
}

function renderChips() {
  const lane = $('chips');
  const nodes = EXAMPLES.map(({ label, command }) => {
    const chip = el('button', 'chip', label);
    chip.type = 'button';
    chip.dataset.command = command;
    chip.title = command;
    return chip;
  });
  replaceChildren(lane, ...nodes);

  lane.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    // Show the full sentence so the phrasing is learnable, then run it.
    $('command-input').value = chip.dataset.command;
    runCommand(chip.dataset.command);
  });

  const updateEdges = () => {
    const atStart = lane.scrollLeft <= 1;
    const atEnd = lane.scrollLeft + lane.clientWidth >= lane.scrollWidth - 1;
    if (atStart && atEnd) lane.removeAttribute('data-edge');
    else if (atStart) lane.dataset.edge = 'end';
    else if (atEnd) lane.dataset.edge = 'start';
    else lane.dataset.edge = 'both';
  };

  lane.addEventListener('scroll', updateEdges, { passive: true });
  window.addEventListener('resize', updateEdges);
  updateEdges();
}

/* ------------------------------------------------------------------ tabs */

function selectTab(name) {
  for (const tab of ['plan', 'catalog']) {
    const button = $(`tab-${tab}`);
    const panel = $(`panel-${tab}`);
    const active = tab === name;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  }
  $('side-scroll').scrollTop = 0;
}

function initTabs() {
  const buttons = [$('tab-plan'), $('tab-catalog')];
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => selectTab(button.id.replace('tab-', '')));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
      next.focus();
      selectTab(next.id.replace('tab-', ''));
    });
  });
}

/* -------------------------------------------------------------- pipeline */

/**
 * @param {Record<string, 'pending'|'active'|'done'|'failed'|'skipped'>} states
 * @param {string} [note]
 */
function setPipeline(states, note) {
  for (const stage of STAGES) {
    const node = document.querySelector(`.pipeline li[data-stage="${stage}"]`);
    if (node) node.dataset.state = states[stage] || 'pending';
  }
  if (note !== undefined) $('pipeline-note').textContent = note;
}

const PIPELINE_IDLE = Object.freeze({
  compile: 'pending', ground: 'pending', authorize: 'pending', execute: 'pending',
});

/** The earliest stage that any issue in a plan belongs to, or null. */
export function failedStageFor(issues = []) {
  let failed = null;
  for (const issue of issues) {
    if (issue.severity !== 'input' && issue.severity !== 'blocked') continue;
    const stage = STAGE_BY_ISSUE_CODE[issue.code] || 'compile';
    if (failed === null || STAGES.indexOf(stage) < STAGES.indexOf(failed)) failed = stage;
  }
  return failed;
}

const STAGE_NOTES = {
  compile: 'stopped: could not be parsed',
  ground: 'stopped: not in the catalog',
  authorize: 'stopped: policy',
};

/** Translate a compiled plan into stage outcomes. */
export function pipelineFromPlan(plan) {
  const failed = failedStageFor(plan.issues);
  if (!failed) {
    return {
      states: { compile: 'done', ground: 'done', authorize: 'done', execute: 'active' },
      note: 'executing',
    };
  }

  const states = {};
  for (const stage of STAGES) {
    const position = STAGES.indexOf(stage) - STAGES.indexOf(failed);
    states[stage] = position < 0 ? 'done' : position === 0 ? 'failed' : 'skipped';
  }
  return { states, note: STAGE_NOTES[failed] || 'stopped' };
}

/* ------------------------------------------------------------------ plan */

function setPlanStatus(status) {
  const pill = $('plan-status');
  pill.textContent = status.replace(/_/g, ' ');
  pill.dataset.state = status;
}

function operationNode(operation, index) {
  const item = el('li', 'op');
  item.dataset.opId = operation.id;

  const head = el('div', 'op-head');
  head.appendChild(el('span', 'op-index', String(index + 1).padStart(2, '0')));
  head.appendChild(el('span', 'op-title', OPERATION_TITLES[operation.type] || operation.type));
  head.appendChild(el('span', 'op-type', operation.type));
  item.appendChild(head);

  // describeOperation embeds predicate values that came from the command.
  item.appendChild(el('p', 'op-detail', describeOperation(operation)));

  const badges = el('div', 'op-badges');
  badges.appendChild(el('span', 'badge', operation.permission));
  const risk = el('span', 'badge', `risk: ${operation.risk}`);
  risk.dataset.risk = operation.risk;
  badges.appendChild(risk);
  if (operation.requiresConfirmation) {
    badges.appendChild(el('span', 'badge confirm', 'needs confirmation'));
  }
  item.appendChild(badges);

  return item;
}

function issueNode(issue) {
  const node = el('div', 'issue');
  node.dataset.severity = issue.severity;
  node.dataset.code = issue.code;
  node.appendChild(el('span', 'issue-message', issue.message));

  const suggestions = issue.details?.suggestions;
  if (Array.isArray(suggestions) && suggestions.length > 0) {
    const row = el('div', 'issue-suggestions');
    for (const suggestion of suggestions) {
      const button = el('button', 'suggestion', suggestion);
      button.type = 'button';
      button.dataset.place = suggestion;
      row.appendChild(button);
    }
    node.appendChild(row);
  }

  node.appendChild(el('code', null, issue.code));
  return node;
}

function renderPlan(plan) {
  setPlanStatus(plan.status);
  selectTab('plan');
  $('plan-empty').hidden = true;
  $('plan-raw').hidden = false;
  $('plan-json').textContent = JSON.stringify(plan, null, 2);

  replaceChildren(
    $('plan-operations'),
    ...plan.operations.map((operation, index) => operationNode(operation, index))
  );

  const issues = $('plan-issues');
  issues.hidden = plan.issues.length === 0;
  replaceChildren(issues, ...plan.issues.map(issueNode));

  renderAtomicNote(plan);
}

/**
 * When a request is only half understood, say so plainly.
 *
 * The executor runs a plan as a unit, so the operations it *did* recognize
 * never ran. Leaving them on screen without that sentence reads as though
 * they had.
 */
function renderAtomicNote(plan) {
  const note = $('atomic-note');
  const halted = plan.status === PLAN_STATUS.NEEDS_INPUT || plan.status === PLAN_STATUS.BLOCKED;
  const recognized = plan.operations.length;

  if (!halted || recognized === 0) {
    note.hidden = true;
    note.replaceChildren();
    return;
  }

  const reason = plan.status === PLAN_STATUS.BLOCKED
    ? 'because another operation is blocked by policy'
    : 'because another part of the request needs clarification';

  note.hidden = false;
  replaceChildren(
    note,
    el('strong', null, `${recognized} recognized operation${recognized === 1 ? '' : 's'} did not run`),
    el('span', null, ` — a request is executed as a whole, so nothing was applied ${reason}.`)
  );

  for (const item of $('plan-operations').children) item.dataset.result = 'not_executed';
}

function renderReceipt(receipt) {
  setPlanStatus(receipt.status);

  for (const result of receipt.results) {
    const node = $('plan-operations').querySelector(`[data-op-id="${CSS.escape(result.operationId || '')}"]`);
    if (!node) continue;
    node.dataset.result = result.status;

    const line = el('p', 'op-result');
    line.dataset.result = result.status;
    // Adapter messages can quote values that came from the command.
    line.textContent = result.status === 'failed'
      ? `failed — ${result.error?.message ?? 'unknown error'}`
      : result.status === 'cancelled'
        ? 'cancelled'
        : describeResult(result);
    node.appendChild(line);
  }

  const orphan = receipt.results.find((result) => !result.operationId && result.error);
  if (orphan) {
    const issues = $('plan-issues');
    issues.hidden = false;
    issues.appendChild(issueNode({
      code: 'execution_failed',
      severity: 'blocked',
      message: orphan.error.message,
    }));
  }
}

/* ------------------------------------------------------------------ core */

/**
 * Resolve once the map has finished moving.
 *
 * A plan can hold several view operations ("go to India and zoom in"). The
 * executor runs them in order and awaits each one, so each has to wait for its
 * animation: starting the next move mid-flight cancels the first and leaves
 * the map somewhere neither operation asked for.
 *
 * The timeout covers the case where a move is a no-op and `moveend` never
 * fires.
 */
function mapSettled(map, timeout = 800) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off('moveend', finish);
      resolve();
    };
    map.on('moveend', finish);
    setTimeout(finish, timeout);
  });
}

function buildCore() {
  const mapAdapter = createFunctionAdapter({
    [OPERATION.VIEW_ZOOM]: async ({ args }) => {
      state.map.setZoom(state.map.getZoom() + (args.delta > 0 ? 1 : -1));
      await mapSettled(state.map);
      return { zoom: state.map.getZoom() };
    },
    [OPERATION.VIEW_PAN]: async ({ args }) => {
      const size = state.map.getSize();
      const offsets = {
        left: [-size.x / 3, 0],
        right: [size.x / 3, 0],
        up: [0, -size.y / 3],
        down: [0, size.y / 3],
      };
      state.map.panBy(offsets[args.direction] || [0, 0]);
      await mapSettled(state.map);
      return { direction: args.direction };
    },
    [OPERATION.VIEW_SET]: async ({ args }) => {
      // A country or region carries bounds; framing the extent is the whole
      // point of resolving it as an area rather than a point.
      if (Array.isArray(args.bounds)) {
        state.map.fitBounds(args.bounds, { padding: [24, 24], animate: true });
        await mapSettled(state.map);
        return { bounds: args.bounds, zoom: state.map.getZoom() };
      }
      if (Array.isArray(args.center)) {
        state.map.setView(args.center, args.zoom ?? 9, { animate: true });
        await mapSettled(state.map);
        return { center: args.center, zoom: state.map.getZoom() };
      }
      return { center: null };
    },
    [OPERATION.VIEW_RESET]: async () => {
      showWholeWorld({ animate: true });
      await mapSettled(state.map);
      return { reset: true };
    },
  });

  state.core = createVoiceGISCore({
    catalog: CATALOG,
    adapter: composeAdapters(state.data, mapAdapter),
    resolvers: [createPlaceResolver({ places: GAZETTEER.places })],
    policy: {
      permissions: [...state.permissions],
      confirm: [OPERATION.DATA_EXPORT, OPERATION.ANALYSIS_BUFFER],
    },
  });
}

/**
 * Ask the operator to approve a confirmation-gated operation.
 *
 * Resolution is driven by the buttons rather than the dialog's `close` event:
 * a missed event would leave this promise pending forever and wedge the
 * command console, and the executor is waiting on it before any side effect.
 */
function confirmOperation(operation) {
  const dialog = $('confirm-dialog');
  const accept = $('confirm-accept');
  const cancel = $('confirm-cancel');

  $('confirm-title').textContent =
    `Confirm: ${OPERATION_TITLES[operation.type] || operation.type}`;

  replaceChildren(
    $('confirm-body'),
    el('span', null, 'This operation is marked '),
    el('code', null, operation.risk),
    el('span', null, ' risk and requires the '),
    el('code', null, operation.permission),
    el('span', null, ' permission.'),
    el('br'),
    el('br'),
    el('code', null, describeOperation(operation))
  );

  return new Promise((resolve) => {
    const finish = (accepted) => {
      accept.removeEventListener('click', onAccept);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onEscape);
      if (dialog.open) dialog.close();
      resolve(accepted);
    };
    const onAccept = () => finish(true);
    const onCancel = () => finish(false);
    const onEscape = (event) => {
      event.preventDefault();
      finish(false);
    };

    accept.addEventListener('click', onAccept);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onEscape);
    dialog.showModal();
  });
}

async function runCommand(text) {
  const input = String(text || '').trim();
  if (!input || state.busy) return;

  state.busy = true;
  setPlanStatus('running');
  $('run-button').disabled = true;
  setPipeline({ ...PIPELINE_IDLE, compile: 'active' }, 'compiling');

  try {
    const plan = await state.core.compile(input);
    renderPlan(plan);

    const { states, note } = pipelineFromPlan(plan);
    setPipeline(states, note);

    if (plan.status === PLAN_STATUS.NEEDS_INPUT || plan.status === PLAN_STATUS.BLOCKED) {
      return;
    }

    const receipt = await state.core.execute(plan, { confirm: confirmOperation });
    renderReceipt(receipt);

    // Anything that fails inside an adapter is an Execute failure, whatever
    // the earlier stages said.
    const executed = receipt.status === 'succeeded' ? 'done'
      : receipt.status === 'cancelled' ? 'skipped' : 'failed';
    setPipeline({ ...states, execute: executed }, receipt.status);

    const selected = state.data.getFeatures('earthquakes', { scope: 'selected' });
    if (selected.length > 0) fitToResult(selected);
    else if (state.data.getState().layers.earthquakes.filter) {
      fitToResult(state.data.getFeatures('earthquakes'));
    }
  } catch (error) {
    console.error(error);
    setPlanStatus('failed');
    setPipeline({ ...PIPELINE_IDLE, compile: 'failed' }, 'failed');
    toast(error.message, 'error');
  } finally {
    state.busy = false;
    $('run-button').disabled = false;
  }
}

/* ----------------------------------------------------------------- voice */

function initVoice() {
  const supported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  if (!supported) return;

  const button = $('mic-button');
  button.hidden = false;

  const engine = new WebSpeechEngine({
    onResult: (transcript, isFinal) => {
      $('command-input').value = transcript;
      if (isFinal) {
        engine.stop();
        runCommand(transcript);
      }
    },
    onStart: () => { button.dataset.listening = 'true'; },
    onEnd: () => { button.dataset.listening = 'false'; },
    onError: (error) => toast(error.message, 'error'),
  });

  button.addEventListener('click', async () => {
    try {
      if (!engine.isInitialized) await engine.init();
      engine.toggle();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  state.speech = engine;
}

/* ---------------------------------------------------------------- chrome */

function toast(message, type = 'info') {
  const node = el('div', 'toast', message);
  node.dataset.type = type;
  $('toasts').appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function downloadExport({ content, filename, mimeType }) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  toast(`Saved ${filename}`);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || window.location.protocol === 'http:') return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  initMap();
  initTabs();
  renderPermissions();
  renderChips();
  renderPlaces();
  setPipeline(PIPELINE_IDLE, 'waiting for a request');

  const { data: quakes, live, generated } = await loadEarthquakes();

  state.data = createGeoJSONAdapter({
    layers: { earthquakes: quakes, cities: CITIES },
    catalog: CATALOG,
    onChange: renderMap,
    onExport: downloadExport,
  });

  buildQuakeMarkers(quakes);
  buildCityMarkers(CITIES);
  buildCore();

  renderCatalog({
    earthquakes: quakes.features.length,
    cities: CITIES.features.length,
  });
  renderMap(state.data.getState());

  $('source-dot').dataset.state = live ? 'live' : 'offline';
  $('source-label').textContent = live
    ? `Live USGS feed · ${formatNumber(quakes.features.length)} earthquakes`
    : `Offline sample · ${formatNumber(quakes.features.length)} earthquakes`;
  $('source-detail').textContent = live
    ? `magnitude 2.5+, past 30 days${generated ? ` · updated ${new Date(generated).toUTCString().slice(5, 22)} UTC` : ''}`
    : 'bundled snapshot — live feed unreachable';

  $('command-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runCommand($('command-input').value);
  });

  // A suggested place should be one click away, not a retype.
  $('plan-issues').addEventListener('click', (event) => {
    const button = event.target.closest('.suggestion');
    if (!button) return;
    const command = `go to ${button.dataset.place}`;
    $('command-input').value = command;
    runCommand(command);
  });

  initVoice();
  registerServiceWorker();

  // Inspection hook. This demo is a reference implementation, so being able to
  // read its live map, adapter state, and compiled plans from the console (or
  // from an end-to-end test) is part of what it is for.
  window.voicegis = {
    get map() { return state.map; },
    get adapter() { return state.data; },
    get core() { return state.core; },
    view() {
      const center = state.map.getCenter();
      return { lat: center.lat, lng: center.lng, zoom: state.map.getZoom() };
    },
  };

  document.body.dataset.ready = 'true';
  $('command-input').focus();
}

boot().catch((error) => {
  console.error('[VoiceGIS demo] failed to start', error);
  toast(`Failed to start: ${error.message}`, 'error');
});
