# Electron Offline Kiosk Integration

Building an offline kiosk (e.g., a museum display, campus directory, or field laptop) is one of VoiceGIS's primary use cases. By utilizing the `WhisperEngine` and local map tiles, you can create a completely disconnected voice-controlled mapping experience.

This recipe covers the necessary steps to run VoiceGIS inside an Electron app offline.

## 1. Architecture Overview

To achieve a 100% offline app, you need three things:
1. **Local Speech Recognition**: VoiceGIS configured to use `WhisperEngine` (Transformers.js).
2. **Local Map Tiles**: Serving map tiles directly from the local file system.
3. **Local Geocoding**: Falling back to a hardcoded city database, or serving a local Nominatim container.

## 2. Bundling the Whisper Model

By default, Transformers.js downloads the Whisper ONNX model from the Hugging Face Hub at runtime and caches it. In a disconnected kiosk, this first download will fail. 

You must pre-download the model and bundle it within your Electron app.

1. Download the `Xenova/whisper-tiny.en` repository from Hugging Face.
2. Place the model files in your Electron project under `public/models/whisper-tiny.en/`.
3. Configure Transformers.js to read from this local path.

## 3. The Electron App Configuration

### Main Process (`main.js`)

You need to ensure Electron's security settings permit microphone access and loading local media.

```javascript
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    kiosk: true, // Fullscreen kiosk mode
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // Necessary if loading local tiles via file:// protocol
    }
  });

  // Automatically grant microphone access
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
```

## 4. VoiceGIS Setup (Renderer Process)

In your `index.html` or renderer script, initialize VoiceGIS with local paths.

```javascript
import { VoiceGIS } from 'voicegis';
import { env } from '@huggingface/transformers';

// Tell transformers.js to load the model locally instead of fetching from the web
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = './models/'; // Path relative to your index.html

const app = new VoiceGIS({
  mapContainerId: 'map',
  // Force whisper engine so it doesn't attempt to use cloud WebSpeech
  speechEngine: 'whisper', 
  // Disable online geocoding
  enableGeocoding: false 
});

// Start listening immediately
app.initSpeech().then(() => {
  app.start();
});

// Intercept commands for kiosk-specific logic
app.registerCommand('IDLE_RESET', /go to sleep/i, () => {
  app.map.resetView();
  showScreensaver();
});
```

## 5. Offline Map Tiles

VoiceGIS defaults to OpenStreetMap online tiles. To use offline tiles, you need to override the default layer.

You have two options for offline tiles:
1. **Local Tile Server**: Run a lightweight Express.js server inside the Electron Main process serving `.mbtiles`.
2. **File Protocol**: Point Leaflet directly to a folder of tiles.

```javascript
// Example using a local tile directory
import L from 'leaflet';

app.map.onAction = ({ action }) => {
  // Wait until the map is initialized
  if (action === 'init') {
    // Remove the default online layer
    app.map.hideLayer('osm');
    
    // Add local tile layer
    L.tileLayer('file://' + __dirname + '/tiles/{z}/{x}/{y}.png', {
      maxZoom: 16,
      minZoom: 12
    }).addTo(app.map._map);
  }
};
```

## 6. Security Considerations for Kiosks

- **Escape Keys**: The `kiosk: true` setting in Electron prevents users from exiting. You may want to register a hidden keyboard shortcut to close the app for maintenance.
- **Microphone Hot-Word**: Running Whisper 100% of the time uses CPU. You might want to combine it with `TfjsEngine` as a wake-word detector, only spinning up Whisper after hearing "Computer".
