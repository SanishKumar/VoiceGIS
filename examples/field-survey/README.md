# Offline Field Survey Example

This example demonstrates how VoiceGIS can be used for offline field data collection (e.g., environmental surveys, infrastructure inspection).

## Key Features Showcased:
1. **Offline Mode**: Uses the `whisper` speech engine directly, simulating an environment with no internet.
2. **Annotated Markers**: Intercepts "add marker [note]" to extract free-text notes along with the command.
3. **Geolocation**: Uses "add marker at my location" to trigger HTML5 Geolocation API and log current coordinates.

## How to run
1. Start the Vite dev server from the project root: `npm run dev`
2. Navigate to `http://localhost:5173/examples/field-survey/index.html`

## Try saying:
- *"Add marker: found water source"*
- *"Add marker at my location: broken fence"*
- *"Undo"* (removes the map view change if any occurred)
