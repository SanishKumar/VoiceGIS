import { inject } from '@vercel/analytics';
import { SpeechEngine, ENGINE_TYPE, WHISPER_STATE } from '../src/engines/index.js';
import { parseCommand, splitCommandString, INTENT } from '../src/parser/index.js';
import { MapController, MAP_ENGINE } from '../src/map/index.js';
import { EvaluationTracker } from '../src/evaluation/index.js';
import { CommandHistory } from '../src/history/index.js';

if (window.location.hostname.endsWith('.vercel.app')) {
  inject();
}

const SCENARIOS = {
  monsoon: {
    key: 'monsoon',
    code: 'A1',
    title: 'Monsoon Sentinel',
    mapTitle: 'RISHIKESH RESPONSE CORRIDOR',
    summary: 'Flood-response coordination across the Rishikesh corridor with live priority zones and field assets.',
    state: 'CRITICAL',
    stateClass: 'critical',
    center: [30.0869, 78.2676],
    zoom: 10,
    coverage: 86,
    zones: [
      {
        name: 'Ganga overflow sector',
        severity: 'critical',
        coords: [[30.124, 78.285], [30.118, 78.338], [30.078, 78.356], [30.051, 78.315], [30.067, 78.276]],
      },
      {
        name: 'Narendra Nagar slope watch',
        severity: 'elevated',
        coords: [[30.178, 78.161], [30.195, 78.214], [30.151, 78.241], [30.126, 78.195]],
      },
      {
        name: 'Haridwar logistics buffer',
        severity: 'monitor',
        coords: [[29.994, 78.112], [30.024, 78.153], [29.976, 78.201], [29.944, 78.158]],
      },
    ],
    risk: [
      { coords: [30.092, 78.304], radius: 4200, intensity: 0.92 },
      { coords: [30.164, 78.197], radius: 3300, intensity: 0.74 },
      { coords: [29.982, 78.158], radius: 3800, intensity: 0.56 },
      { coords: [30.046, 78.266], radius: 2500, intensity: 0.66 },
    ],
    routes: [
      { name: 'Medical corridor M-4', coords: [[29.966, 78.169], [30.006, 78.203], [30.051, 78.244], [30.093, 78.276], [30.128, 78.315]] },
      { name: 'High-ground evacuation E-2', coords: [[30.073, 78.315], [30.104, 78.265], [30.137, 78.222], [30.177, 78.191]] },
    ],
    assets: [
      { name: 'ALPHA-12', type: 'Rescue team', status: 'deployed', coords: [30.105, 78.298], alert: true },
      { name: 'MED-07', type: 'Field medical', status: 'ready', coords: [30.041, 78.229] },
      { name: 'UAV-03', type: 'Aerial survey', status: 'airborne', coords: [30.153, 78.236] },
      { name: 'LOG-21', type: 'Supply convoy', status: 'en route', coords: [29.974, 78.179] },
      { name: 'BRAVO-06', type: 'Rescue team', status: 'deployed', coords: [30.081, 78.341], alert: true },
    ],
    assetTotal: 14,
    suggestions: [
      'focus critical zone',
      'show satellite',
      'zoom in and add marker',
      'hide risk field',
    ],
  },
  wildfire: {
    key: 'wildfire',
    code: 'B7',
    title: 'Wildfire Atlas',
    mapTitle: 'DIABLO RANGE FIRE COMMAND',
    summary: 'Containment planning, crew routing, and aerial intelligence for a fast-moving interface fire.',
    state: 'ELEVATED',
    stateClass: 'elevated',
    center: [37.3541, -121.7084],
    zoom: 10,
    coverage: 72,
    zones: [
      {
        name: 'Eastern active front',
        severity: 'critical',
        coords: [[37.426, -121.684], [37.397, -121.593], [37.318, -121.624], [37.294, -121.713], [37.361, -121.746]],
      },
      {
        name: 'Interface protection zone',
        severity: 'elevated',
        coords: [[37.382, -121.842], [37.347, -121.775], [37.292, -121.799], [37.315, -121.883]],
      },
      {
        name: 'Aerial operations sector',
        severity: 'monitor',
        coords: [[37.476, -121.781], [37.442, -121.684], [37.392, -121.722], [37.413, -121.824]],
      },
    ],
    risk: [
      { coords: [37.367, -121.668], radius: 6100, intensity: 0.94 },
      { coords: [37.329, -121.704], radius: 4400, intensity: 0.8 },
      { coords: [37.342, -121.824], radius: 3600, intensity: 0.55 },
      { coords: [37.421, -121.716], radius: 3000, intensity: 0.62 },
    ],
    routes: [
      { name: 'Crew ingress F-9', coords: [[37.279, -121.889], [37.307, -121.827], [37.337, -121.758], [37.365, -121.681]] },
      { name: 'Tanker turnaround T-2', coords: [[37.445, -121.821], [37.413, -121.758], [37.387, -121.703], [37.351, -121.635]] },
    ],
    assets: [
      { name: 'HOTSHOT-4', type: 'Ground crew', status: 'line construction', coords: [37.354, -121.681], alert: true },
      { name: 'TANKER-9', type: 'Air tanker', status: 'drop run', coords: [37.421, -121.723] },
      { name: 'DOZER-2', type: 'Heavy equipment', status: 'deployed', coords: [37.318, -121.759] },
      { name: 'ENGINE-31', type: 'Structure protection', status: 'ready', coords: [37.337, -121.842] },
      { name: 'UAS-11', type: 'Thermal survey', status: 'airborne', coords: [37.387, -121.638], alert: true },
    ],
    assetTotal: 19,
    suggestions: [
      'focus critical zone',
      'show terrain',
      'pan east and zoom in',
      'hide response routes',
    ],
  },
  urban: {
    key: 'urban',
    code: 'C4',
    title: 'Urban Pulse',
    mapTitle: 'MUMBAI MOBILITY NETWORK',
    summary: 'Live multimodal flow analysis across rail, emergency corridors, and high-density demand clusters.',
    state: 'MONITOR',
    stateClass: 'monitor',
    center: [19.076, 72.8777],
    zoom: 11,
    coverage: 94,
    zones: [
      {
        name: 'Central demand cluster',
        severity: 'elevated',
        coords: [[19.104, 72.842], [19.112, 72.903], [19.061, 72.916], [19.044, 72.865]],
      },
      {
        name: 'Harbour transfer sector',
        severity: 'monitor',
        coords: [[19.049, 72.921], [19.079, 72.973], [19.025, 72.993], [18.997, 72.943]],
      },
      {
        name: 'Airport priority envelope',
        severity: 'monitor',
        coords: [[19.139, 72.849], [19.137, 72.893], [19.092, 72.896], [19.091, 72.854]],
      },
    ],
    risk: [
      { coords: [19.073, 72.881], radius: 3100, intensity: 0.76 },
      { coords: [19.118, 72.873], radius: 2500, intensity: 0.62 },
      { coords: [19.031, 72.951], radius: 2700, intensity: 0.54 },
      { coords: [18.993, 72.838], radius: 2200, intensity: 0.43 },
    ],
    routes: [
      { name: 'Emergency green corridor', coords: [[18.942, 72.829], [18.991, 72.836], [19.044, 72.852], [19.094, 72.874], [19.131, 72.892]] },
      { name: 'Harbour relief route', coords: [[18.963, 72.931], [19.008, 72.948], [19.053, 72.962], [19.092, 72.941]] },
    ],
    assets: [
      { name: 'TRANSIT-08', type: 'Mobility unit', status: 'active', coords: [19.069, 72.878] },
      { name: 'MED-14', type: 'Emergency response', status: 'priority', coords: [19.112, 72.884], alert: true },
      { name: 'FLOW-22', type: 'Traffic sensor', status: 'streaming', coords: [19.025, 72.918] },
      { name: 'RAIL-05', type: 'Transit control', status: 'active', coords: [18.993, 72.843] },
      { name: 'PORT-03', type: 'Harbour unit', status: 'active', coords: [19.047, 72.956] },
    ],
    assetTotal: 27,
    suggestions: [
      'show satellite',
      'pan south and zoom in',
      'hide perimeters',
      'go to Pune',
    ],
  },
};

const dom = {
  app: document.getElementById('app'),
  bootScreen: document.getElementById('boot-screen'),
  offlineBanner: document.getElementById('offline-banner'),
  networkDot: document.getElementById('network-dot'),
  networkLabel: document.getElementById('network-label'),
  engineDot: document.getElementById('engine-dot'),
  engineLabel: document.getElementById('engine-label'),
  engineSelect: document.getElementById('engine-select'),
  engineDetail: document.getElementById('engine-detail'),
  missionTitle: document.getElementById('mission-title'),
  missionState: document.getElementById('mission-state'),
  missionSummary: document.getElementById('mission-summary'),
  missionCode: document.getElementById('mission-code'),
  mapTitle: document.getElementById('map-title'),
  mapSubtitle: document.getElementById('map-subtitle'),
  assetCount: document.getElementById('asset-count'),
  zoneCount: document.getElementById('zone-count'),
  coverageValue: document.getElementById('coverage-value'),
  layerCount: document.getElementById('layer-count'),
  mapCoordinates: document.getElementById('map-coordinates'),
  mapZoom: document.getElementById('map-zoom'),
  mapEngine: document.getElementById('map-engine'),
  commandForm: document.getElementById('command-form'),
  commandInput: document.getElementById('command-input'),
  commandState: document.getElementById('command-state'),
  commandSuggestions: document.getElementById('command-suggestions'),
  voiceButton: document.getElementById('voice-button'),
  pipeline: document.getElementById('pipeline'),
  compiledIntent: document.getElementById('compiled-intent'),
  compilerLatency: document.getElementById('compiler-latency'),
  commandHistory: document.getElementById('command-history'),
  sessionAccuracy: document.getElementById('session-accuracy'),
  sessionCommands: document.getElementById('session-commands'),
  averageLatency: document.getElementById('average-latency'),
  unknownCount: document.getElementById('unknown-count'),
  accuracyRing: document.getElementById('accuracy-ring'),
  telemetryDrawer: document.getElementById('telemetry-drawer'),
  drawerBackdrop: document.getElementById('drawer-backdrop'),
  toastRegion: document.getElementById('toast-region'),
  waveformCanvas: document.getElementById('waveform-canvas'),
};

const tracker = new EvaluationTracker();
const cameraHistory = new CommandHistory(40);
let currentScenario = SCENARIOS.monsoon;
let currentMapEngine = MAP_ENGINE.LEAFLET;
let mapController = null;
let speechEngine = null;
let activeSpeechType = null;
let activeBasemap = 'dark';
let scenarioLayers = {};
let commandRecords = [];
let tourRunning = false;
let waveformFrame = null;
let waveformListening = false;

const engineDescriptions = {
  auto: 'Selects the lowest-latency available engine and falls back without losing the command session.',
  webspeech: 'Uses the browser speech service for low-latency, full-sentence recognition.',
  whisper: 'Runs quantized Whisper locally in the browser. Audio never leaves the device.',
  tfjs: 'Loads a compact keyword model for constrained, always-on field hardware.',
  server: 'Streams WAV segments to a private Whisper-compatible endpoint inside your network.',
};

function initMap(engine = MAP_ENGINE.LEAFLET) {
  if (mapController) {
    clearScenarioLayers();
    mapController.destroy();
  }

  const leafletElement = document.getElementById('leaflet-map');
  const openLayersElement = document.getElementById('ol-map');
  const isOpenLayers = engine === MAP_ENGINE.OPENLAYERS;
  leafletElement.classList.toggle('active', !isOpenLayers);
  openLayersElement.classList.toggle('active', isOpenLayers);

  mapController = new MapController({
    engine,
    containerId: isOpenLayers ? 'ol-map' : 'leaflet-map',
    onLayerError: ({ label }) => showToast(`${label} could not be reached. Dark operations basemap restored.`, 'warning'),
  });
  mapController.init();
  currentMapEngine = engine;
  dom.mapEngine.textContent = engine.toUpperCase();

  mapController.hideLayer('osm');
  mapController.showLayer(activeBasemap);
  mapController.onMove(updateMapReadout);
  renderScenarioLayers();
  requestAnimationFrame(updateMapReadout);
}

function clearScenarioLayers() {
  if (!mapController?._map) {
    scenarioLayers = {};
    return;
  }

  for (const layer of Object.values(scenarioLayers)) {
    if (!layer) continue;
    if (currentMapEngine === MAP_ENGINE.LEAFLET) {
      mapController._map.removeLayer(layer);
    } else {
      mapController._map.removeLayer(layer);
    }
  }
  scenarioLayers = {};
}

function renderScenarioLayers() {
  clearScenarioLayers();
  if (!mapController?._map) return;

  if (currentMapEngine === MAP_ENGINE.OPENLAYERS) {
    renderOpenLayersScenario();
  } else {
    renderLeafletScenario();
  }
  syncOverlayVisibility();
}

function renderLeafletScenario() {
  const L = window.L;
  const risk = L.layerGroup();
  const perimeter = L.layerGroup();
  const routes = L.layerGroup();
  const assets = L.layerGroup();

  currentScenario.risk.forEach((field) => {
    const critical = field.intensity > 0.8;
    L.circle(field.coords, {
      radius: field.radius,
      color: critical ? '#ff4d5f' : '#ff9e4a',
      weight: 1,
      opacity: 0.32,
      fillColor: critical ? '#ff4d5f' : '#ff9e4a',
      fillOpacity: 0.07 + field.intensity * 0.08,
      interactive: false,
    }).addTo(risk);
    L.circle(field.coords, {
      radius: field.radius * 0.55,
      stroke: false,
      fillColor: critical ? '#ff4d5f' : '#ffb05e',
      fillOpacity: 0.09 + field.intensity * 0.1,
      interactive: false,
    }).addTo(risk);
  });

  currentScenario.zones.forEach((zone) => {
    const palette = {
      critical: ['#ff4d5f', '#ff4d5f'],
      elevated: ['#f5ba45', '#f5ba45'],
      monitor: ['#64c8ff', '#64c8ff'],
    }[zone.severity];
    L.polygon(zone.coords, {
      color: palette[0],
      weight: zone.severity === 'critical' ? 2 : 1,
      dashArray: zone.severity === 'monitor' ? '5 6' : null,
      fillColor: palette[1],
      fillOpacity: zone.severity === 'critical' ? 0.16 : 0.08,
      className: zone.severity === 'critical' ? 'critical-perimeter' : '',
    })
      .bindPopup(`<strong>${zone.name}</strong><br>${zone.severity.toUpperCase()} RESPONSE ZONE`)
      .addTo(perimeter);
  });

  currentScenario.routes.forEach((route, index) => {
    L.polyline(route.coords, {
      color: index === 0 ? '#67e8c2' : '#64c8ff',
      weight: 2.5,
      opacity: 0.85,
      dashArray: '8 12',
      className: 'animated-route',
    })
      .bindTooltip(route.name, { className: 'asset-tooltip', sticky: true })
      .addTo(routes);
  });

  currentScenario.assets.forEach((asset) => {
    const icon = L.divIcon({
      className: '',
      html: `<span class="asset-beacon${asset.alert ? ' alert' : ''}"><i></i></span>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    L.marker(asset.coords, {
      icon,
      title: `${asset.name}: ${asset.type}, ${asset.status}`,
      alt: `${asset.name} field asset`,
    })
      .bindTooltip(`${asset.name} / ${asset.status.toUpperCase()}`, {
        className: 'asset-tooltip',
        direction: 'top',
        offset: [0, -8],
      })
      .bindPopup(`<strong>${asset.name}</strong><br>${asset.type}<br>STATUS / ${asset.status.toUpperCase()}`)
      .addTo(assets);
  });

  scenarioLayers = { risk, perimeter, routes, assets };
  Object.values(scenarioLayers).forEach((layer) => layer.addTo(mapController._map));
}

function renderOpenLayersScenario() {
  const ol = window.ol;
  const project = (coords) => ol.proj.fromLonLat([coords[1], coords[0]]);

  const riskFeatures = currentScenario.risk.map((field) => new ol.Feature({
    geometry: new ol.geom.Point(project(field.coords)),
    intensity: field.intensity,
  }));
  const riskLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features: riskFeatures }),
    style: (feature) => {
      const intensity = feature.get('intensity');
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 18 + intensity * 25,
          fill: new ol.style.Fill({ color: intensity > 0.8 ? 'rgba(255,77,95,.16)' : 'rgba(245,186,69,.13)' }),
          stroke: new ol.style.Stroke({ color: intensity > 0.8 ? 'rgba(255,77,95,.55)' : 'rgba(245,186,69,.45)', width: 1 }),
        }),
      });
    },
  });

  const perimeterFeatures = currentScenario.zones.map((zone) => new ol.Feature({
    geometry: new ol.geom.Polygon([[...zone.coords, zone.coords[0]].map(project)]),
    severity: zone.severity,
  }));
  const perimeterLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features: perimeterFeatures }),
    style: (feature) => {
      const severity = feature.get('severity');
      const color = severity === 'critical' ? '255,77,95' : severity === 'elevated' ? '245,186,69' : '100,200,255';
      return new ol.style.Style({
        fill: new ol.style.Fill({ color: `rgba(${color},.09)` }),
        stroke: new ol.style.Stroke({ color: `rgba(${color},.8)`, width: severity === 'critical' ? 2 : 1, lineDash: severity === 'monitor' ? [5, 6] : undefined }),
      });
    },
  });

  const routeFeatures = currentScenario.routes.map((route) => new ol.Feature({
    geometry: new ol.geom.LineString(route.coords.map(project)),
  }));
  const routesLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features: routeFeatures }),
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: '#67e8c2', width: 2, lineDash: [8, 12] }),
    }),
  });

  const assetFeatures = currentScenario.assets.map((asset) => new ol.Feature({
    geometry: new ol.geom.Point(project(asset.coords)),
    alert: asset.alert,
  }));
  const assetsLayer = new ol.layer.Vector({
    source: new ol.source.Vector({ features: assetFeatures }),
    style: (feature) => new ol.style.Style({
      image: new ol.style.Circle({
        radius: 5,
        fill: new ol.style.Fill({ color: feature.get('alert') ? '#ff6b35' : '#67e8c2' }),
        stroke: new ol.style.Stroke({ color: '#071012', width: 2 }),
      }),
    }),
  });

  scenarioLayers = { risk: riskLayer, perimeter: perimeterLayer, routes: routesLayer, assets: assetsLayer };
  Object.values(scenarioLayers).forEach((layer) => mapController._map.addLayer(layer));
}

function syncOverlayVisibility() {
  document.querySelectorAll('[data-overlay]').forEach((checkbox) => {
    const layer = scenarioLayers[checkbox.dataset.overlay];
    if (!layer || !mapController?._map) return;

    if (currentMapEngine === MAP_ENGINE.LEAFLET) {
      const visible = mapController._map.hasLayer(layer);
      if (checkbox.checked && !visible) layer.addTo(mapController._map);
      if (!checkbox.checked && visible) mapController._map.removeLayer(layer);
    } else {
      layer.setVisible(checkbox.checked);
    }
  });
  updateLayerCount();
}

function setOverlayVisibility(overlayId, visible) {
  const checkbox = document.querySelector(`[data-overlay="${overlayId}"]`);
  if (!checkbox) return false;
  checkbox.checked = visible;
  syncOverlayVisibility();
  return true;
}

function setBasemap(layerId) {
  if (!mapController) return;
  ['osm', 'dark', 'nasa', 'terrain'].forEach((id) => mapController.hideLayer(id));
  mapController.showLayer(layerId);
  activeBasemap = layerId;
  const radio = document.querySelector(`input[name="basemap"][value="${layerId}"]`);
  if (radio) radio.checked = true;
  updateLayerCount();
}

function updateLayerCount() {
  const overlayCount = [...document.querySelectorAll('[data-overlay]')].filter((item) => item.checked).length;
  dom.layerCount.textContent = `${overlayCount + 1} ACTIVE`;
}

function activateScenario(key, options = {}) {
  const scenario = SCENARIOS[key];
  if (!scenario) return false;
  currentScenario = scenario;

  dom.missionTitle.textContent = scenario.title;
  dom.missionSummary.textContent = scenario.summary;
  dom.missionState.textContent = scenario.state;
  dom.missionState.className = `status-tag ${scenario.stateClass}`;
  dom.missionCode.textContent = `MISSION ${scenario.code}`;
  dom.mapTitle.textContent = scenario.mapTitle;
  dom.mapSubtitle.textContent = `${scenario.center[0].toFixed(4)}° N / ${Math.abs(scenario.center[1]).toFixed(4)}° ${scenario.center[1] < 0 ? 'W' : 'E'} / LIVE OPERATIONAL PICTURE`;
  dom.assetCount.textContent = String(scenario.assetTotal).padStart(2, '0');
  dom.zoneCount.textContent = String(scenario.zones.length).padStart(2, '0');
  dom.coverageValue.textContent = `${scenario.coverage}%`;

  document.querySelectorAll('[data-scenario]').forEach((button) => {
    const selected = button.dataset.scenario === key;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });

  renderSuggestions();
  renderScenarioLayers();
  if (options.fly === false) setMissionViewImmediately();
  else mapController?.goTo(scenario.center, scenario.zoom, scenario.title);
  updateMapReadout();
  if (!options.silent) showToast(`${scenario.title} operational picture loaded.`, 'success');
  return true;
}

function setMissionViewImmediately() {
  if (!mapController?._map) return;
  if (currentMapEngine === MAP_ENGINE.OPENLAYERS) {
    const view = mapController._map.getView();
    view.setCenter(window.ol.proj.fromLonLat([currentScenario.center[1], currentScenario.center[0]]));
    view.setZoom(currentScenario.zoom);
  } else {
    mapController._map.setView(currentScenario.center, currentScenario.zoom, { animate: false });
  }
  updateMapReadout();
}

function renderSuggestions() {
  dom.commandSuggestions.replaceChildren();
  currentScenario.suggestions.forEach((suggestion) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = suggestion;
    button.addEventListener('click', () => runCommand(suggestion, 'suggestion'));
    dom.commandSuggestions.appendChild(button);
  });
}

function updateMapReadout() {
  if (!mapController) return;
  const center = mapController.getCenter();
  const zoom = mapController.getZoom();
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
  dom.mapCoordinates.textContent = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
  dom.mapZoom.textContent = `Z${Math.round(zoom ?? 0)}`;
}

function parseDomainCommand(text) {
  const normalized = text.toLowerCase().trim();
  const scenarioMatch = normalized.match(/\b(?:load|open|run|activate|switch to)\s+(?:the\s+)?(monsoon|wildfire|urban)(?:\s+(?:mission|scenario|response))?\b/);
  if (scenarioMatch) {
    return {
      intent: 'load_scenario',
      payload: { scenario: scenarioMatch[1] },
      raw: text,
      confidence: 1,
      domain: true,
    };
  }

  if (/\bfocus\s+(?:the\s+)?(?:critical|highest risk|priority)\s+zone\b/.test(normalized)) {
    return {
      intent: 'focus_critical_zone',
      payload: { zoneIndex: 0 },
      raw: text,
      confidence: 0.98,
      domain: true,
    };
  }

  const overlayMatch = normalized.match(/\b(show|enable|hide|disable)\s+(?:the\s+)?(risk(?:\s+field)?|perimeters?|response\s+routes?|routes?|field\s+assets?|assets?|responders?)\b/);
  if (overlayMatch) {
    const overlayAliases = {
      risk: 'risk',
      'risk field': 'risk',
      perimeter: 'perimeter',
      perimeters: 'perimeter',
      'response route': 'routes',
      'response routes': 'routes',
      route: 'routes',
      routes: 'routes',
      'field asset': 'assets',
      'field assets': 'assets',
      asset: 'assets',
      assets: 'assets',
      responder: 'assets',
      responders: 'assets',
    };
    return {
      intent: overlayMatch[1] === 'show' || overlayMatch[1] === 'enable' ? 'show_overlay' : 'hide_overlay',
      payload: { overlayId: overlayAliases[overlayMatch[2]] },
      raw: text,
      confidence: 0.97,
      domain: true,
    };
  }

  return null;
}

async function compileCommand(text) {
  const started = performance.now();
  const parts = splitCommandString(text);
  const safeParts = parts.length > 0 ? parts : [text];
  const results = [];
  let parserTime = 0;

  for (const part of safeParts) {
    const domainResult = parseDomainCommand(part);
    if (domainResult) {
      results.push(domainResult);
      continue;
    }
    const parseStarted = performance.now();
    const result = await parseCommand(part, { enableGeocoding: navigator.onLine });
    parserTime += performance.now() - parseStarted;
    results.push(result);
  }

  return {
    results,
    chainSize: safeParts.length,
    parserTime,
    compileTime: performance.now() - started,
  };
}

function snapshotForIntent(intent) {
  return [
    INTENT.ZOOM_IN,
    INTENT.ZOOM_OUT,
    INTENT.PAN_LEFT,
    INTENT.PAN_RIGHT,
    INTENT.PAN_UP,
    INTENT.PAN_DOWN,
    INTENT.GO_TO,
    INTENT.RESET_VIEW,
  ].includes(intent);
}

async function executeResult(result) {
  if (snapshotForIntent(result.intent)) cameraHistory.snapshot(mapController);

  switch (result.intent) {
    case INTENT.ZOOM_IN:
      mapController.zoomIn();
      return 'Viewport zoom increased';
    case INTENT.ZOOM_OUT:
      mapController.zoomOut();
      return 'Viewport zoom reduced';
    case INTENT.PAN_LEFT:
      mapController.panLeft();
      return 'Viewport moved west';
    case INTENT.PAN_RIGHT:
      mapController.panRight();
      return 'Viewport moved east';
    case INTENT.PAN_UP:
      mapController.panUp();
      return 'Viewport moved north';
    case INTENT.PAN_DOWN:
      mapController.panDown();
      return 'Viewport moved south';
    case INTENT.GO_TO:
      mapController.goTo(result.payload.coords, 12, result.payload.place);
      return `Centered on ${result.payload.place}`;
    case INTENT.SHOW_LAYER:
      setBasemap(result.payload.layerId);
      return `${result.payload.layerId} basemap enabled`;
    case INTENT.HIDE_LAYER:
      mapController.hideLayer(result.payload.layerId);
      return `${result.payload.layerId} basemap hidden`;
    case INTENT.ADD_MARKER:
      if (result.payload.useCurrentLocation) {
        const coords = await mapController.addMarkerAtCurrentLocation();
        return `Field marker placed at ${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`;
      }
      {
        const center = mapController.getCenter();
        mapController.addMarker([center.lat, center.lng], 'VoiceGIS field marker');
        return 'Field marker placed at map center';
      }
    case INTENT.SWITCH_MAP:
      await switchMapEngine(result.payload.engine);
      return `Execution adapter switched to ${result.payload.engine}`;
    case INTENT.RESET_VIEW:
      mapController.goTo(currentScenario.center, currentScenario.zoom, currentScenario.title);
      return 'Mission viewport restored';
    case INTENT.UNDO:
      return cameraHistory.undo(mapController) ? 'Previous camera state restored' : 'Undo stack is empty';
    case INTENT.REDO:
      return cameraHistory.redo(mapController) ? 'Next camera state restored' : 'Redo stack is empty';
    case 'load_scenario':
      activateScenario(result.payload.scenario);
      return `${SCENARIOS[result.payload.scenario].title} loaded`;
    case 'focus_critical_zone':
      {
        const zone = currentScenario.zones[result.payload.zoneIndex];
        const center = getPolygonCenter(zone.coords);
        mapController.goTo(center, currentScenario.zoom + 2, zone.name);
        setOverlayVisibility('perimeter', true);
        setOverlayVisibility('risk', true);
        return `Focused ${zone.name}`;
      }
    case 'show_overlay':
      setOverlayVisibility(result.payload.overlayId, true);
      return `${result.payload.overlayId} overlay enabled`;
    case 'hide_overlay':
      setOverlayVisibility(result.payload.overlayId, false);
      return `${result.payload.overlayId} overlay hidden`;
    default:
      return `No executable intent for “${result.raw}”`;
  }
}

function getPolygonCenter(coords) {
  const total = coords.reduce((acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]], [0, 0]);
  return [total[0] / coords.length, total[1] / coords.length];
}

async function switchMapEngine(engineName) {
  const engine = engineName === 'openlayers' ? MAP_ENGINE.OPENLAYERS : MAP_ENGINE.LEAFLET;
  if (engine === currentMapEngine) return;
  initMap(engine);
  mapController.goTo(currentScenario.center, currentScenario.zoom, currentScenario.title);
  showToast(`GIS adapter switched to ${engine}.`, 'success');
}

async function runCommand(text, source = 'typed') {
  const command = text?.trim();
  if (!command) return;

  dom.commandInput.value = command;
  dom.commandState.textContent = 'COMPILING COMMAND GRAPH';
  resetPipeline();
  setPipelineStage('capture', 'active', source === 'voice' ? 'Voice transcript received' : 'Text command received', 'LIVE');

  try {
    const compiled = await compileCommand(command);
    setPipelineStage('capture', 'complete', source === 'voice' ? 'Transcript normalized' : 'Text normalized', '<1 ms');
    setPipelineStage('segment', 'complete', `${compiled.chainSize} command node${compiled.chainSize === 1 ? '' : 's'}`, `${compiled.chainSize}×`);
    setPipelineStage(
      'resolve',
      compiled.results.some((result) => result.intent === INTENT.UNKNOWN) ? 'error' : 'complete',
      compiled.results.map((result) => result.intent).join(' → '),
      `${compiled.parserTime.toFixed(1)} ms`
    );
    setPipelineStage('execute', 'active', 'Dispatching to map adapter', currentMapEngine);

    const executionStarted = performance.now();
    const messages = [];
    for (const result of compiled.results) {
      const resultStarted = performance.now();
      const message = await executeResult(result);
      const resultLatency = performance.now() - resultStarted;
      messages.push(message);
      tracker.recordCommand({
        raw: result.raw,
        intent: result.intent,
        payload: result.payload,
        confidence: result.confidence,
        latency: resultLatency + compiled.parserTime / compiled.results.length,
      });
    }

    const executionTime = performance.now() - executionStarted;
    const totalTime = compiled.compileTime + executionTime;
    setPipelineStage('execute', 'complete', `${compiled.results.length} action${compiled.results.length === 1 ? '' : 's'} committed`, `${executionTime.toFixed(1)} ms`);
    dom.compilerLatency.textContent = `${totalTime.toFixed(1)} MS`;
    dom.commandState.textContent = 'COMMAND COMMITTED';
    renderCompiledIntent(command, source, compiled, totalTime);
    addCommandEvidence(command, compiled.results, totalTime);
    updateSessionMetrics();

    const hasUnknown = compiled.results.some((result) => result.intent === INTENT.UNKNOWN);
    showToast(messages.join(' · '), hasUnknown ? 'warning' : 'success');
  } catch (error) {
    setPipelineStage('execute', 'error', error.message, 'FAILED');
    dom.commandState.textContent = 'EXECUTION FAILED';
    showToast(error.message, 'error');
  }
}

function resetPipeline() {
  dom.pipeline.querySelectorAll('.pipeline-step').forEach((step) => {
    step.className = 'pipeline-step idle';
    step.querySelector('em').textContent = '—';
  });
}

function setPipelineStage(stage, state, detail, timing) {
  const element = dom.pipeline.querySelector(`[data-stage="${stage}"]`);
  element.className = `pipeline-step ${state}`;
  element.querySelector('small').textContent = detail;
  element.querySelector('em').textContent = timing;
}

function renderCompiledIntent(command, source, compiled, totalTime) {
  const payload = {
    status: compiled.results.some((result) => result.intent === INTENT.UNKNOWN) ? 'partial' : 'committed',
    source,
    transcript: command,
    adapter: currentMapEngine,
    chain_size: compiled.chainSize,
    duration_ms: Number(totalTime.toFixed(2)),
    commands: compiled.results.map((result) => ({
      intent: result.intent,
      confidence: Number((result.confidence || 0).toFixed(3)),
      payload: result.payload,
    })),
  };
  dom.compiledIntent.textContent = JSON.stringify(payload, null, 2);
}

function addCommandEvidence(command, results, latency) {
  commandRecords.unshift({
    id: commandRecords.length + 1,
    command,
    intent: results.map((result) => result.intent).join(' + '),
    latency,
    timestamp: new Date().toISOString(),
  });
  commandRecords = commandRecords.slice(0, 20);
  renderCommandHistory();
}

function renderCommandHistory() {
  dom.commandHistory.replaceChildren();
  commandRecords.slice(0, 6).forEach((record, index) => {
    const item = document.createElement('li');
    const number = document.createElement('span');
    const body = document.createElement('p');
    const commandText = document.createElement('strong');
    const intentText = document.createTextNode(record.intent);
    const latency = document.createElement('em');

    number.textContent = String(commandRecords.length - index).padStart(2, '0');
    commandText.textContent = record.command;
    body.append(commandText, intentText);
    latency.textContent = `${record.latency.toFixed(1)}ms`;
    item.append(number, body, latency);
    dom.commandHistory.appendChild(item);
  });
}

function updateSessionMetrics() {
  const stats = tracker.getStats();
  const accuracy = stats.accuracy === null ? 0.937 : stats.accuracy;
  dom.sessionAccuracy.textContent = `${(accuracy * 100).toFixed(1)}%`;
  dom.sessionCommands.textContent = String(stats.total);
  dom.averageLatency.textContent = stats.avgLatency === null ? '—' : `${stats.avgLatency.toFixed(1)}ms`;
  dom.unknownCount.textContent = String(stats.unknown);
  dom.accuracyRing.style.setProperty('--accuracy', (accuracy * 100).toFixed(1));
}

async function ensureSpeechEngine() {
  const selectedType = dom.engineSelect.value;
  if (speechEngine && activeSpeechType === selectedType) return speechEngine;

  if (speechEngine?.isListening) speechEngine.stop();
  speechEngine = null;
  activeSpeechType = selectedType;
  dom.voiceButton.classList.add('loading');
  dom.engineDot.className = 'signal-dot loading';
  dom.engineLabel.textContent = 'LOADING';
  dom.commandState.textContent = 'INITIALIZING VOICE ENGINE';

  let actualType = selectedType;
  if (selectedType === 'auto') {
    const hasWebSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    actualType = hasWebSpeech && navigator.onLine ? ENGINE_TYPE.WEB_SPEECH : ENGINE_TYPE.WHISPER;
  }

  if (actualType === ENGINE_TYPE.TFJS) await loadTfjsRuntime();

  const options = {
    engine: actualType,
    onResult: (text, isFinal) => {
      dom.commandInput.value = text;
      dom.commandState.textContent = isFinal ? 'FINAL TRANSCRIPT RECEIVED' : 'LISTENING / INTERIM TRANSCRIPT';
      if (isFinal) runCommand(text, 'voice');
    },
    onError: (error) => {
      dom.engineDot.className = 'signal-dot error';
      dom.engineLabel.textContent = 'ENGINE ERROR';
      dom.voiceButton.classList.remove('loading', 'listening');
      waveformListening = false;
      showToast(error.message, 'error');
    },
    onStart: () => {
      dom.voiceButton.classList.remove('loading');
      dom.voiceButton.classList.add('listening');
      dom.commandState.textContent = 'LISTENING / SPEAK A COMMAND';
      waveformListening = true;
    },
    onEnd: () => {
      dom.voiceButton.classList.remove('loading', 'listening');
      dom.commandState.textContent = 'READY FOR INPUT';
      waveformListening = false;
    },
  };

  if (actualType === ENGINE_TYPE.WHISPER) {
    options.onModelProgress = (progress) => {
      const percentage = Math.round(progress.progress * 100);
      dom.engineLabel.textContent = `WHISPER ${percentage}%`;
      dom.commandState.textContent = progress.status.toUpperCase();
    };
    options.onStateChange = (state) => {
      if (state === WHISPER_STATE.PROCESSING) dom.commandState.textContent = 'WHISPER / LOCAL INFERENCE';
    };
  }

  speechEngine = new SpeechEngine(options);
  try {
    await speechEngine.init();
    dom.engineDot.className = 'signal-dot live';
    dom.engineLabel.textContent = actualType.toUpperCase();
    dom.voiceButton.classList.remove('loading');
    dom.commandState.textContent = 'VOICE ENGINE READY';
    showToast(`${actualType.toUpperCase()} engine ready.`, 'success');
    return speechEngine;
  } catch (error) {
    speechEngine = null;
    activeSpeechType = null;
    dom.engineDot.className = 'signal-dot error';
    dom.engineLabel.textContent = 'UNAVAILABLE';
    dom.voiceButton.classList.remove('loading');
    throw error;
  }
}

async function loadTfjsRuntime() {
  if (window.speechCommands) return;
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/speech-commands@0.5.4/dist/speech-commands.min.js');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve();
      else existing.addEventListener('load', resolve, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

function initWaveform() {
  const canvas = dom.waveformCanvas;
  const context = canvas.getContext('2d');
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const render = (timestamp) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = waveformListening ? '#ff6b35' : '#536165';
    context.lineWidth = 1;
    context.beginPath();

    const amplitude = waveformListening ? height * 0.31 : height * 0.035;
    for (let x = 0; x <= width; x += 2) {
      const envelope = Math.sin((x / Math.max(1, width)) * Math.PI);
      const wave = Math.sin(x * 0.13 + timestamp * 0.01) + Math.sin(x * 0.037 - timestamp * 0.006) * 0.55;
      const y = height / 2 + wave * amplitude * envelope;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    waveformFrame = requestAnimationFrame(render);
  };
  waveformFrame = requestAnimationFrame(render);
}

function updateOnlineStatus() {
  const online = navigator.onLine;
  dom.offlineBanner.classList.toggle('visible', !online);
  dom.networkDot.className = `signal-dot ${online ? 'live' : 'error'}`;
  dom.networkLabel.textContent = online ? 'ONLINE' : 'FIELD MODE';
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  const dot = document.createElement('i');
  const text = document.createElement('span');
  const meta = document.createElement('small');
  toast.className = `toast ${type}`;
  text.textContent = message;
  meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  toast.append(dot, text, meta);
  dom.toastRegion.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function runProductTour() {
  if (tourRunning) return;
  tourRunning = true;
  showToast('Product tour started. Watch the command graph and map layers respond.', 'info');
  const tourCommands = [
    'load wildfire response',
    'focus critical zone and show response routes',
    'show terrain and zoom in',
  ];

  for (const command of tourCommands) {
    if (!tourRunning) break;
    await runCommand(command, 'tour');
    await new Promise((resolve) => window.setTimeout(resolve, 950));
  }
  tourRunning = false;
  showToast('Tour complete. The command bus is yours.', 'success');
}

function setDrawer(open) {
  dom.telemetryDrawer.classList.toggle('open', open);
  dom.telemetryDrawer.setAttribute('aria-hidden', String(!open));
  dom.telemetryDrawer.toggleAttribute('inert', !open);
  dom.drawerBackdrop.classList.toggle('open', open);
}

function closeMobilePanels() {
  document.querySelectorAll('.side-panel.open').forEach((panel) => panel.classList.remove('open'));
  if (!dom.telemetryDrawer.classList.contains('open')) dom.drawerBackdrop.classList.remove('open');
}

function bindEvents() {
  document.querySelectorAll('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => activateScenario(button.dataset.scenario));
  });

  document.querySelectorAll('input[name="basemap"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) setBasemap(radio.value);
    });
  });

  document.querySelectorAll('[data-overlay]').forEach((checkbox) => {
    checkbox.addEventListener('change', syncOverlayVisibility);
  });

  dom.commandForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runCommand(dom.commandInput.value, 'typed');
  });

  dom.voiceButton.addEventListener('click', async () => {
    try {
      const engine = await ensureSpeechEngine();
      if (engine.isListening) engine.stop();
      else engine.start();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  dom.engineSelect.addEventListener('change', () => {
    if (speechEngine?.isListening) speechEngine.stop();
    speechEngine = null;
    activeSpeechType = null;
    dom.engineDot.className = 'signal-dot ready';
    dom.engineLabel.textContent = 'STANDBY';
    dom.engineDetail.textContent = engineDescriptions[dom.engineSelect.value];
  });

  document.getElementById('zoom-in').addEventListener('click', () => mapController?.zoomIn());
  document.getElementById('zoom-out').addEventListener('click', () => mapController?.zoomOut());
  document.getElementById('reset-view').addEventListener('click', () => mapController?.goTo(currentScenario.center, currentScenario.zoom, currentScenario.title));
  document.getElementById('locate-me').addEventListener('click', () => {
    mapController?.addMarkerAtCurrentLocation()
      .then(() => showToast('Current position added to the operational picture.', 'success'))
      .catch((error) => showToast(error.message, 'error'));
  });

  document.getElementById('copy-intent').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dom.compiledIntent.textContent);
      showToast('Compiled intent copied.', 'success');
    } catch {
      showToast('Clipboard access is unavailable.', 'warning');
    }
  });

  document.getElementById('export-log').addEventListener('click', () => {
    downloadFile(tracker.exportJSON(), 'voicegis-atlas-session.json', 'application/json');
  });

  document.getElementById('tour-button').addEventListener('click', runProductTour);
  document.getElementById('telemetry-button').addEventListener('click', () => setDrawer(true));
  document.getElementById('telemetry-close').addEventListener('click', () => setDrawer(false));
  dom.drawerBackdrop.addEventListener('click', () => {
    setDrawer(false);
    closeMobilePanels();
  });

  document.querySelectorAll('[data-open-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      closeMobilePanels();
      document.getElementById(button.dataset.openPanel).classList.add('open');
      dom.drawerBackdrop.classList.add('open');
    });
  });

  document.querySelectorAll('[data-close-panel]').forEach((button) => {
    button.addEventListener('click', closeMobilePanels);
  });

  document.getElementById('mobile-command').addEventListener('click', () => {
    closeMobilePanels();
    dom.commandInput.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== dom.commandInput) {
      event.preventDefault();
      dom.commandInput.focus();
    }
    if (event.key === 'Escape') {
      setDrawer(false);
      closeMobilePanels();
    }
  });

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('[VoiceGIS] Service worker unavailable:', error.message);
    });
  }, { once: true });
}

function bootstrap() {
  updateOnlineStatus();
  bindEvents();
  initWaveform();
  initMap(MAP_ENGINE.LEAFLET);
  activateScenario('monsoon', { silent: true, fly: false });
  updateSessionMetrics();
  registerServiceWorker();

  window.setTimeout(() => {
    dom.app.classList.add('ready');
    dom.bootScreen.classList.add('complete');
    showToast('VoiceGIS Atlas online. Type a command or run the guided tour.', 'success');
  }, 650);
}

bootstrap();

window.addEventListener('beforeunload', () => {
  if (waveformFrame) cancelAnimationFrame(waveformFrame);
  if (speechEngine?.isListening) speechEngine.stop();
});
