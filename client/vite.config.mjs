import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep existing deployments working while they migrate from Create React
  // App's REACT_APP_* convention to Vite's VITE_* convention.
  envPrefix: ['VITE_', 'REACT_APP_'],
  build: {
    outDir: 'build',
    emptyOutDir: true
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000'
    }
  }
});
