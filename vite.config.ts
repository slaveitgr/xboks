import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/work/**', '**/outputs/**', '**/release/**', '**/assets/social-backend/**', '**/dist-electron/**'] } },
});
