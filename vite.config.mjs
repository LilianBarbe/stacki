import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { themeLab } from './scripts/theme-lab-plugin.mjs';

export default defineConfig({
  plugins: [react(), themeLab()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
