import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Des chemins relatifs permettent d'ouvrir dist/index.html directement,
  // et fonctionnent aussi sur GitHub Pages quel que soit le nom du dépôt.
  base: './',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
