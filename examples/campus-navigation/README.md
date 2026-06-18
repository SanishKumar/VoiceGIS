# Campus Navigator Example

This example demonstrates how to use VoiceGIS to build a domain-specific voice experience for an indoor/outdoor campus map (using Lovely Professional University as the dataset).

## Key Features Showcased:
1. **Custom Commands**: Intercepting `take me to [building]` via `app.registerCommand()`.
2. **Fuzzy Search against GeoJSON**: Mapping spoken text to features in a local dataset.
3. **Data Filtering**: Showing/hiding markers based on spoken categories ("show me academic buildings").
4. **Undo Support**: The example integrates the `CommandHistory` module, allowing users to say "undo" after navigating to a building.

## How to run
1. Start the Vite dev server from the project root: `npm run dev`
2. Navigate to `http://localhost:5173/examples/campus-navigation/index.html`

## Try saying:
- *"Take me to Uni Mall"*
- *"Where is the Central Library?"*
- *"Show me academic buildings"*
- *"Undo"* (to go back to the previous view)
