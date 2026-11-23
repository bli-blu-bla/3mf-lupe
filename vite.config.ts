import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on any GitHub Pages path (user.github.io/<repo>/)
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1200 },
});
