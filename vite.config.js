import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Two pages: the app, and the tiny single sign-on bridge (see src/sso-bridge.js).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        'sso-bridge': resolve(import.meta.dirname, 'auth/sso-bridge.html'),
      },
    },
  },
});
