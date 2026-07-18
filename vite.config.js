import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // ---------------------------------------------------------------------------
  // Dev Server — serves the demo app at http://localhost:5173/demo/
  // ---------------------------------------------------------------------------
  server: {
    open: '/demo/index.html',
    port: 5173,
  },

  // ---------------------------------------------------------------------------
  // Library Build — produces publishable ESM + UMD bundles
  // ---------------------------------------------------------------------------
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'VoiceGIS',
      formats: ['es', 'umd'],
      fileName: (format) => format === 'umd' ? 'voicegis.umd.cjs' : 'voicegis.es.js',
    },
    outDir: 'dist',
    rollupOptions: {
      // Do not bundle peer dependencies — consumers provide these
      external: [
        'leaflet',
        'ol',
        '@huggingface/transformers',
        '@tensorflow/tfjs',
        '@tensorflow-models/speech-commands',
      ],
      output: {
        globals: {
          leaflet: 'L',
          ol: 'ol',
          '@huggingface/transformers': 'transformers',
          '@tensorflow/tfjs': 'tf',
          '@tensorflow-models/speech-commands': 'speechCommands',
        },
      },
    },
  },
});
