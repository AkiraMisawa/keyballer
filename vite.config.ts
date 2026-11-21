import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative asset paths so the same build works at any URL path,
// such as https://<user>.github.io/keyballer/.
export default defineConfig({
  base: './',
  plugins: [react()],
});
