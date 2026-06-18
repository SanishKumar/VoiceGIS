# Next.js + Leaflet Dashboard Integration

Using `VoiceGIS` in a Next.js environment requires handling Server-Side Rendering (SSR) correctly, because both Leaflet and the Web Speech API depend on browser APIs (`window`, `navigator`) that are undefined on the Node.js server.

This recipe shows you how to build a production-ready Next.js Dashboard with VoiceGIS.

## 1. Installation

```bash
npm install voicegis leaflet
npm install -D @types/leaflet
```

## 2. The `useVoiceGIS` Hook

Create a custom hook `hooks/useVoiceGIS.ts` to manage the VoiceGIS lifecycle cleanly within React.

```typescript
import { useState, useEffect, useRef } from 'react';
// We don't import VoiceGIS at the top level to avoid SSR errors.

export function useVoiceGIS(mapContainerId: string) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('idle');
  
  const vgisRef = useRef<any>(null);

  useEffect(() => {
    // Dynamic import to bypass SSR
    let unmounted = false;
    
    import('voicegis').then(({ VoiceGIS }) => {
      if (unmounted) return;

      const app = new VoiceGIS({
        mapContainerId,
        speechEngine: 'auto',
        onStateChange: (state) => setStatus(state),
        onCommandParsed: (result, raw) => setTranscript(raw)
      });

      app.initSpeech().then(() => {
        vgisRef.current = app;
      });
    });

    return () => {
      unmounted = true;
      if (vgisRef.current) {
        vgisRef.current.stop();
      }
    };
  }, [mapContainerId]);

  const toggleListening = () => {
    if (!vgisRef.current) return;
    
    if (isListening) {
      vgisRef.current.stop();
      setIsListening(false);
    } else {
      vgisRef.current.start();
      setIsListening(true);
    }
  };

  return { isListening, toggleListening, transcript, status };
}
```

## 3. The Map Component

Because Leaflet manipulates the DOM directly, the Map component itself must be dynamically imported with `ssr: false`.

`components/MapClient.tsx`:

```tsx
import { useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
import { useVoiceGIS } from '../hooks/useVoiceGIS';

export default function MapClient() {
  const { isListening, toggleListening, transcript, status } = useVoiceGIS('map-root');

  return (
    <div className="relative w-full h-screen">
      {/* Map Container */}
      <div id="map-root" className="w-full h-full z-0" />

      {/* Voice Overlay UI */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center">
        {transcript && (
          <div className="mb-4 px-4 py-2 bg-slate-800 text-white rounded-lg shadow-lg">
            "{transcript}"
          </div>
        )}
        
        <button 
          onClick={toggleListening}
          className={`px-6 py-3 rounded-full font-bold shadow-xl transition-colors ${
            isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'
          } text-white`}
        >
          {isListening ? '🛑 Stop Listening' : '🎙️ Start Voice Command'}
        </button>
        <div className="mt-2 text-xs text-slate-500 font-mono uppercase tracking-widest">
          Status: {status}
        </div>
      </div>
    </div>
  );
}
```

## 4. The Page Wrapper

Finally, import the MapClient dynamically in your page.

`app/page.tsx` (Next.js App Router):

```tsx
'use client';

import dynamic from 'next/dynamic';

// Critical: Disable SSR for the map component
const MapWithVoice = dynamic(() => import('../components/MapClient'), {
  ssr: false,
  loading: () => <div className="w-full h-screen flex items-center justify-center">Loading Map...</div>
});

export default function Dashboard() {
  return (
    <main className="w-full h-screen">
      <MapWithVoice />
    </main>
  );
}
```

## Troubleshooting

**"window is not defined" error:**
This means `voicegis` or `leaflet` was imported in a file that Next.js tried to render on the server. Always use `next/dynamic` with `{ ssr: false }` for the component that imports these libraries, or use dynamic `import('voicegis')` inside a `useEffect`.

**Leaflet tiles not loading / Gray box:**
Ensure you have imported Leaflet's CSS: `import 'leaflet/dist/leaflet.css';`. Next.js requires this in your component or global `layout.tsx`.
