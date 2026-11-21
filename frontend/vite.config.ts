import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * Multi-page build. Each portal is a separate HTML document with its own bundle,
 * so a user only downloads the code for the portal they open.
 */
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'local';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version} (${commit})`)
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        property: resolve(__dirname, 'property.html'),
        frontdesk: resolve(__dirname, 'frontdesk.html'),
        cashier: resolve(__dirname, 'cashier.html'),
        audit: resolve(__dirname, 'audit.html'),
        password: resolve(__dirname, 'password.html')
      }
    }
  }
});
