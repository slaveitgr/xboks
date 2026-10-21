import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // The WebRTC player's EventEmitter is browser-local; never externalize it to Node.
  resolve: {alias: {events: 'events/'}},
  build: { outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/work/**', '**/outputs/**', '**/release/**', '**/assets/social-backend/**', '**/dist-electron/**'] } },
});
