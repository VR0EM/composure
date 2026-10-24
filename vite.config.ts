import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Content-Security-Policy for the production build. It enforces the privacy
 * promise in the README: the page can only talk to its own origin, so even a
 * compromised dependency cannot send your Compose file anywhere.
 * (Dev mode is left alone because Vite's HMR needs inline scripts and websockets.)
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'composure-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (/node_modules\/(@codemirror|@lezer|codemirror|crelt|style-mod|w3c-keyname)\//.test(id)) {
            return 'codemirror';
          }
          if (/node_modules\/(@xyflow|d3-[a-z-]+|zustand|classcat)\//.test(id)) return 'xyflow';
          // elkjs stays out of manual chunks so its fallback build is only fetched on demand
          return undefined;
        },
      },
    },
  },
});
