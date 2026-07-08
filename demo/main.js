/**
 * main.js — VoiceGIS demo entry point (ES module)
 *
 * Wires together:
 *   SpeechEngine  → Recognizes speech
 *   parseCommand  → Converts text to structured action
 *   MapController → Executes action on the map
 *   EvaluationTracker → Records metrics
 *   AudioCapture / WaveformRenderer → Visualizes audio
 */

import { inject } from '@vercel/analytics';
import { SpeechEngine, ENGINE_TYPE, WHISPER_STATE } from '../src/engines/index.js';
import { parseCommand, INTENT } from '../src/parser/index.js';
import { MapController, MAP_ENGINE } from '../src/map/index.js';
import { EvaluationTracker } from '../src/evaluation/index.js';
import { AudioCapture, WaveformRenderer } from '../src/audio/index.js';

// Initialize Vercel Web Analytics
inject();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentMapEngine = MAP_ENGINE.LEAFLET;
let speechEngine     = null;
let mapController    = null;
let audioCapture     = null;
let waveform         = null;
const tracker        = new EvaluationTracker();

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

// UI Elements
const voiceBtn         = document.getElementById('voice-btn');
const transcriptEl     = document.getElementById('transcript');
const mapOverlay       = document.getElementById('map-overlay');
const overlayMsg       = document.getElementById('overlay-msg');
const notifContainer   = document.getElementById('notif-container');
const offlineBanner    = document.getElementById('offline-banner');

// Settings Drawer
const settingsToggle   = document.getElementById('settings-toggle');
const drawerClose      = document.getElementById('drawer-close');
const settingsDrawer   = document.getElementById('settings-drawer');
const drawerBackdrop   = document.getElementById('drawer-backdrop');

// Selects
const engineSelect     = document.getElementById('engine-select');
const mapSelect        = document.getElementById('map-select');

// Whisper Progress
const whisperProgressContainer = document.getElementById('whisper-progress-container');
const whisperStatusText        = document.getElementById('whisper-status-text');
const whisperStatusPct         = document.getElementById('whisper-status-pct');
const whisperProgressBar       = document.getElementById('whisper-progress-bar');

// Status Bar & Pills
const engineStatusDot  = document.querySelector('#engine-status .status-dot');
const engineStatusText = document.querySelector('#engine-status .status-text');
const mapStatusText    = document.querySelector('#map-status .status-text');
const statusCoords     = document.getElementById('status-coords');
const statusZoom       = document.getElementById('status-zoom');

// Stats
const statTotal        = document.getElementById('stat-total');
const statRecognized   = document.getElementById('stat-recognized');
const statUnknown      = document.getElementById('stat-unknown');
const statAccuracy     = document.getElementById('stat-accuracy');
const statLatency      = document.getElementById('stat-latency');
const statSession      = document.getElementById('stat-session');

// ---------------------------------------------------------------------------
// Setup Audio Visualization
// ---------------------------------------------------------------------------

function initAudioVisualization() {
  const canvas = document.getElementById('waveform-canvas');
  if (!canvas) return;
  
  waveform = new WaveformRenderer(canvas);
  waveform.setStyle({ style: 'bars', color: '#3b82f6' });
}

async function startAudioCapture() {
  // Try to get AnalyserNode from WhisperEngine if it's running
  if (speechEngine && speechEngine._delegate && typeof speechEngine._delegate.getAudioCapture === 'function') {
    const ac = speechEngine._delegate.getAudioCapture();
    if (ac && waveform) {
      waveform.setAnalyserNode(ac.getAnalyserNode());
      waveform.start();
      return;
    }
  }

  // Fallback: create standalone AudioCapture for WebSpeech / TF.js
  if (!audioCapture) {
    audioCapture = new AudioCapture({
      onSilence: () => {},
      onAudioData: () => {}
    });
  }
  
  if (!audioCapture.isCapturing) {
    try {
      await audioCapture.start();
      if (waveform) {
        waveform.setAnalyserNode(audioCapture.getAnalyserNode());
        waveform.start();
      }
    } catch (e) {
      console.warn('Audio capture failed:', e);
    }
  }
}

function stopAudioCapture() {
  if (waveform) waveform.stop();
  if (audioCapture && audioCapture.isCapturing) {
    audioCapture.stop();
  }
}

// ---------------------------------------------------------------------------
// Map Initialization
// ---------------------------------------------------------------------------

function initMap(engine) {
  if (mapController) {
    mapController.destroy();
    mapController = null;
  }

  const leafletDiv = document.getElementById('leaflet-map');
  const olDiv      = document.getElementById('ol-map');

  if (engine === MAP_ENGINE.OPENLAYERS) {
    leafletDiv.classList.remove('active');
    olDiv.classList.add('active');
  } else {
    olDiv.classList.remove('active');
    leafletDiv.classList.add('active');
  }

  const containerId = engine === MAP_ENGINE.OPENLAYERS ? 'ol-map' : 'leaflet-map';

  try {
    mapController = new MapController({
      engine,
      containerId,
      onAction: () => {},
      onLayerError: handleLayerError,
    });
    mapController.init();
    currentMapEngine = engine;

    mapStatusText.textContent = engine === MAP_ENGINE.LEAFLET ? 'Leaflet' : 'OpenLayers';
    mapController.onMove(updateStatusBar);
    updateStatusBar();
    syncLayerToggles();
  } catch (err) {
    showNotif(`⚠ Map failed to initialize: ${err.message}`, 'error');
    console.error(err);
  }
}

function updateStatusBar() {
  if (!mapController) return;
  const c = mapController.getCenter();
  const zoom = mapController.getZoom();
  statusCoords.textContent = `Lat: ${c.lat.toFixed(4)}, Lng: ${c.lng.toFixed(4)}`;
  statusZoom.textContent   = `Zoom: ${zoom !== undefined ? Math.round(zoom) : '—'}`;
}

// ---------------------------------------------------------------------------
// Layer Toggles
// ---------------------------------------------------------------------------

function syncLayerToggles() {
  document.querySelectorAll('[data-layer]').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) {
        mapController.showLayer(cb.dataset.layer);
      } else {
        mapController.hideLayer(cb.dataset.layer);
      }
    };
  });
}

function setLayerCheckbox(layerId, checked) {
  const cb = document.querySelector(`[data-layer="${layerId}"]`);
  if (cb) cb.checked = checked;
}

function handleLayerError({ layerId, label }) {
  setLayerCheckbox(layerId, false);
  showNotif(`⚠ Layer "${label || layerId}" failed to load.`, 'error');
}

function switchMapEngine(newEngine) {
  overlayMsg.textContent = `Switching to ${newEngine === MAP_ENGINE.OPENLAYERS ? 'OpenLayers' : 'Leaflet'}…`;
  mapOverlay.classList.add('visible');

  setTimeout(() => {
    initMap(newEngine);
    mapSelect.value = newEngine;
    mapOverlay.classList.remove('visible');
    showNotif(`🗺️ Switched to ${newEngine === MAP_ENGINE.OPENLAYERS ? 'OpenLayers' : 'Leaflet'}`, 'success');
  }, 400);
}

// ---------------------------------------------------------------------------
// Speech Engine Initialization
// ---------------------------------------------------------------------------

async function initSpeechEngine(type) {
  voiceBtn.disabled = true;
  engineStatusDot.className = 'status-dot loading';
  
  // Clean up old engine if it exists
  if (speechEngine && speechEngine.isListening) {
    speechEngine.stop();
  }

  // Handle AUTO routing explicitly in the demo
  let actualType = type;
  if (type === 'auto') {
    const hasWebSpeech = typeof window !== 'undefined' && 
      (window.SpeechRecognition || window.webkitSpeechRecognition);
    actualType = (hasWebSpeech && navigator.onLine) ? ENGINE_TYPE.WEB_SPEECH : ENGINE_TYPE.WHISPER;
  }

  let label = 'Web Speech';
  if (actualType === ENGINE_TYPE.TFJS) label = 'Offline Command Mode';
  if (actualType === ENGINE_TYPE.WHISPER) label = 'Whisper Advanced';
  if (actualType === 'server') label = 'Private Server API';
  
  engineStatusText.textContent = `Loading ${label}...`;

  if (actualType === ENGINE_TYPE.WHISPER) {
    whisperProgressContainer.style.display = 'block';
    whisperStatusPct.textContent = '0%';
    whisperProgressBar.style.width = '0%';
  } else {
    whisperProgressContainer.style.display = 'none';
  }

  const options = {
    engine: actualType,
    onResult: handleSpeechResult,
    onError: async (err) => {
      handleSpeechError(err);
      
      // Auto fallback logic
      if (type === 'auto') {
        if (actualType === ENGINE_TYPE.WEB_SPEECH) {
          showNotif('WebSpeech failed, falling back to Whisper...', 'warning');
          await initSpeechEngine(ENGINE_TYPE.WHISPER);
        } else if (actualType === ENGINE_TYPE.WHISPER) {
          showNotif('Whisper failed, falling back to Command Mode...', 'warning');
          await initSpeechEngine(ENGINE_TYPE.TFJS);
        }
      }
    },
    onStart: () => {
      voiceBtn.classList.remove('pulse-idle', 'processing');
      voiceBtn.classList.add('listening');
      startAudioCapture();
    },
    onEnd: () => {
      voiceBtn.classList.remove('listening', 'processing');
      voiceBtn.classList.add('pulse-idle');
      stopAudioCapture();
    },
  };

  if (actualType === ENGINE_TYPE.WHISPER) {
    options.onModelProgress = (info) => {
      const pct = Math.round(info.progress * 100);
      whisperStatusText.textContent = info.status;
      whisperStatusPct.textContent = `${pct}%`;
      whisperProgressBar.style.width = `${pct}%`;
    };
    options.onStateChange = (state) => {
      if (state === WHISPER_STATE.PROCESSING) {
        voiceBtn.classList.remove('listening', 'pulse-idle');
        voiceBtn.classList.add('processing');
        transcriptEl.textContent = 'Processing audio...';
        transcriptEl.className = 'interim';
      }
    };
  }
  
  if (actualType === 'server') {
    options.apiUrl = 'http://localhost:8000/transcribe';
  }

  // Use the legacy SpeechEngine wrapper for the demo for now,
  // which will route to createEngine under the hood.
  speechEngine = new SpeechEngine(options);

  try {
    await speechEngine.init();
    
    // Update UI Status Pill
    engineStatusDot.className = 'status-dot online';
    if (actualType === ENGINE_TYPE.WHISPER) {
      engineStatusText.textContent = 'Whisper AI';
      setTimeout(() => { whisperProgressContainer.style.display = 'none'; }, 1000);
    } else if (actualType === ENGINE_TYPE.TFJS) {
      engineStatusText.textContent = 'Command Mode';
    } else if (actualType === 'server') {
      engineStatusText.textContent = 'Server API';
    } else {
      engineStatusText.textContent = 'Web Speech';
    }
    
    voiceBtn.disabled = false;
  } catch (err) {
    showNotif(`⚠ Speech engine failed: ${err.message}`, 'error');
    engineStatusDot.className = 'status-dot error';
    engineStatusText.textContent = 'Engine Error';
  }
}

// ---------------------------------------------------------------------------
// Speech Result Handling
// ---------------------------------------------------------------------------

async function handleSpeechResult(text, isFinal) {
  transcriptEl.textContent = text || '...';
  transcriptEl.className   = isFinal ? 'final' : 'interim';

  if (!isFinal || !text) return;

  const t0 = performance.now();
  const result = await parseCommand(text);
  const parseTime = performance.now() - t0;

  const actionLatency = executeAction(result);

  tracker.recordCommand({
    raw: text,
    intent: result.intent,
    payload: result.payload,
    confidence: result.confidence,
    latency: actionLatency + parseTime,
  });

  updateStats();
}

function handleSpeechError(err) {
  showNotif(`🎙️ ${err.message}`, 'error');
  voiceBtn.classList.remove('listening', 'processing');
  voiceBtn.classList.add('pulse-idle');
}

// ---------------------------------------------------------------------------
// Action Execution
// ---------------------------------------------------------------------------

function executeAction(result) {
  const t0 = performance.now();

  if (!mapController) return performance.now() - t0;

  switch (result.intent) {
    case INTENT.ZOOM_IN:
      mapController.zoomIn();
      showNotif('🔍 Zoomed in', 'success');
      break;
    case INTENT.ZOOM_OUT:
      mapController.zoomOut();
      showNotif('🔍 Zoomed out', 'success');
      break;
    case INTENT.GO_TO:
      mapController.goTo(result.payload.coords, 12, result.payload.place);
      showNotif(`✈ Going to ${result.payload.place}`, 'success');
      break;
    case INTENT.SHOW_LAYER:
      mapController.showLayer(result.payload.layerId);
      setLayerCheckbox(result.payload.layerId, true);
      showNotif(`🗂️ Showing ${result.payload.alias || result.payload.layerId}`, 'success');
      break;
    case INTENT.HIDE_LAYER:
      mapController.hideLayer(result.payload.layerId);
      setLayerCheckbox(result.payload.layerId, false);
      showNotif(`🗂️ Hiding ${result.payload.alias || result.payload.layerId}`, 'info');
      break;
    case INTENT.ADD_MARKER:
      if (result.payload.useCurrentLocation) {
        mapController.addMarkerAtCurrentLocation()
          .then(([lat, lng]) => showNotif(`📍 Marker at ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success'))
          .catch((err) => showNotif(`⚠ ${err.message}`, 'error'));
      } else {
        const c = mapController.getCenter();
        mapController.addMarker([c.lat, c.lng], '📍 Marker');
        showNotif(`📍 Marker added`, 'success');
      }
      break;
    case INTENT.SWITCH_MAP: {
      const newEngine = result.payload.engine === 'openlayers' ? MAP_ENGINE.OPENLAYERS : MAP_ENGINE.LEAFLET;
      if (newEngine !== currentMapEngine) switchMapEngine(newEngine);
      break;
    }
    case INTENT.RESET_VIEW:
      mapController.resetView();
      showNotif('🌍 View reset', 'info');
      break;
    default:
      showNotif(`❓ Unrecognized: "${result.raw}"`, 'warning');
      break;
  }

  return performance.now() - t0;
}

// ---------------------------------------------------------------------------
// UI Utilities & Event Listeners
// ---------------------------------------------------------------------------

function updateStats() {
  const s = tracker.getStats();
  statTotal.textContent = s.total;
  statRecognized.textContent = s.recognized;
  statUnknown.textContent = s.unknown;
  statAccuracy.textContent = s.accuracy !== null ? `${(s.accuracy * 100).toFixed(1)}%` : '—';
  statLatency.textContent = s.avgLatency !== null ? `${s.avgLatency.toFixed(0)} ms` : '—';

  const sec = Math.floor(s.sessionDurationMs / 1000);
  const mins = Math.floor(sec / 60);
  statSession.textContent = mins > 0 ? `${mins}m ${sec % 60}s` : `${sec}s`;
}

function showNotif(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `notif ${type}`;
  el.textContent = msg;
  notifContainer.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// Drawer Handlers
function toggleDrawer() {
  settingsDrawer.classList.toggle('open');
  drawerBackdrop.classList.toggle('open');
}
settingsToggle.addEventListener('click', toggleDrawer);
drawerClose.addEventListener('click', toggleDrawer);
drawerBackdrop.addEventListener('click', toggleDrawer);

// Voice Button & Hotkey
voiceBtn.addEventListener('click', () => {
  if (speechEngine && speechEngine.isInitialized) speechEngine.toggle();
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
    e.preventDefault();
    if (speechEngine && speechEngine.isInitialized) speechEngine.toggle();
  }
});

// Map controls
document.getElementById('btn-zoom-in').addEventListener('click', () => mapController?.zoomIn());
document.getElementById('btn-zoom-out').addEventListener('click', () => mapController?.zoomOut());
document.getElementById('btn-reset').addEventListener('click', () => mapController?.resetView());
document.getElementById('btn-locate').addEventListener('click', () => {
  mapController?.addMarkerAtCurrentLocation().catch(err => showNotif(`⚠ ${err.message}`, 'error'));
});

// Engine & Map Selects
engineSelect.addEventListener('change', () => {
  const type = engineSelect.value; // 'webspeech', 'tfjs', 'whisper'
  initSpeechEngine(type);
});
mapSelect.addEventListener('change', () => {
  const newEngine = mapSelect.value === 'openlayers' ? MAP_ENGINE.OPENLAYERS : MAP_ENGINE.LEAFLET;
  if (newEngine !== currentMapEngine) switchMapEngine(newEngine);
});


// Stats Buttons
document.getElementById('export-json').addEventListener('click', () => {
  downloadFile(tracker.exportJSON(), 'voicegis-session.json', 'application/json');
});
document.getElementById('export-csv').addEventListener('click', () => {
  downloadFile(tracker.exportCSV(), 'voicegis-session.csv', 'text/csv');
});
document.getElementById('reset-stats').addEventListener('click', () => {
  tracker.reset();
  updateStats();
});

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// PWA & Offline Support
// ---------------------------------------------------------------------------

function updateOnlineStatus() {
  if (navigator.onLine) {
    offlineBanner.classList.remove('visible');
    // If we are in auto mode and came back online, we could switch to WebSpeech.
    if (engineSelect.value === 'auto' && speechEngine?.engine !== ENGINE_TYPE.WEB_SPEECH) {
      showNotif('Back online, switching to Cloud engine...', 'info');
      initSpeechEngine('auto');
    }
  } else {
    offlineBanner.classList.add('visible');
    // If we are in auto mode and went offline, switch to Whisper automatically.
    if (engineSelect.value === 'auto' && speechEngine?.engine === ENGINE_TYPE.WEB_SPEECH) {
      showNotif('Went offline, switching to Whisper Engine...', 'warning');
      initSpeechEngine('auto');
    }
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('[ServiceWorker] Registered', reg.scope))
      .catch((err) => console.error('[ServiceWorker] Registration failed', err));
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

setInterval(updateStats, 1000);

(async () => {
  updateOnlineStatus();
  registerServiceWorker();
  
  initAudioVisualization();
  initMap(MAP_ENGINE.LEAFLET);
  await initSpeechEngine('auto');
  updateStats();
  showNotif('🗺️ VoiceGIS ready. Tap 🎙️ or press Space to start.', 'info');
})();
