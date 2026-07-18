import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Root directory where index.html is located for the app build
  root: 'demo',
  // Relative assets work both at a root domain and under GitHub Pages /VoiceGIS/.
  base: './',
  build: {
    // Output directory relative to project root
    outDir: '../dist-demo',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'demo/index.html'),
    }
  }
});
