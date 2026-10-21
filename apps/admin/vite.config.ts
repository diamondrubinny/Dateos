import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // No inline scripts or styles, so a strict Content Security Policy works.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
