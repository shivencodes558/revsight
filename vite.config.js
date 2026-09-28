import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend always calls "/api/...". In dev, Vite proxies that to the local
// Express server on :8788. In prod on Vercel, "/api/..." hits the serverless
// functions on the same origin — so no environment-specific base URL is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174, // 5174 so it won't clash with Adsight's 5173
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
        timeout: 120000,        // 2 min — the first all-channel aggregation is heavy
        proxyTimeout: 120000,
      },
    },
  },
});
