import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep the legacy API variable available without exposing every
  // REACT_APP_* value to browser code.
  envPrefix: ['VITE_', 'REACT_APP_API_URL'],
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
