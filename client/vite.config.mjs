import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep the legacy API variable available without exposing every
  // REACT_APP_* value to browser code.
  envPrefix: ['VITE_', 'REACT_APP_API_URL'],
  build: {
    outDir: 'build',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // P14: React-Framework getrennt vom App-Code cachen (kein Over-Splitting:
        // genau ein Vendor-Chunk für react/react-dom, alles andere bleibt dynamisch).
        // Vite 8/Rolldown erwartet manualChunks als Funktion.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000'
    }
  }
});
