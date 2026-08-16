import { defineConfig } from 'vite';
import { resolve } from 'path';

const entries = {
  core: resolve(__dirname, 'src/core/index.js'),
  adapters: resolve(__dirname, 'src/adapters/index.js'),
  parser: resolve(__dirname, 'src/parser/index.js'),
  map: resolve(__dirname, 'src/map/index.js'),
  engines: resolve(__dirname, 'src/engines/index.js'),
  evaluation: resolve(__dirname, 'src/evaluation/index.js'),
  audio: resolve(__dirname, 'src/audio/index.js'),
};

export default defineConfig({
  build: {
    lib: {
      entry: entries,
      formats: ['es', 'cjs'],
      fileName: (format, entryName) =>
        `${entryName}/index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      external: [
        'leaflet',
        'ol',
        '@huggingface/transformers',
        '@tensorflow/tfjs',
        '@tensorflow-models/speech-commands',
      ],
      output: {
        exports: 'named',
      },
    },
  },
});
