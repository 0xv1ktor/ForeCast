import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createForecastApiHandler } from './server/arciumStakeService.mjs';

export default defineConfig({
  plugins: [react(), forecastApiPlugin()],
  server: {
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/target/**',
        '**/.anchor/**',
        '**/test-ledger/**',
        '**/arcium/**/build/**',
      ],
    },
    proxy: {
      '/api/polymarket': {
        target: 'https://gamma-api.polymarket.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/polymarket/, ''),
      },
    },
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  define: {
    global: 'globalThis',
    'process.env': {},
  },
  optimizeDeps: {
    include: ['buffer'],
  },
});

function forecastApiPlugin() {
  return {
    name: 'forecast-local-api',
    configureServer(server) {
      const handler = createForecastApiHandler();
      server.middlewares.use(handler);
    },
  };
}
