import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      // The build output directory
      out: 'build',
    }),
    alias: {
      $lib: './src/lib',
    },

    // Pin SvelteKit default — explicit so a future PR cannot silently downgrade
    // it for the form-action surface while exempting the Bearer-token API.
    csrf: { checkOrigin: true },

    // Mode 'auto': nonces injected for SSR'd pages, hashes for prerendered.
    // TODO(csp): verify in dev/preview and tighten further once verified:
    //   - 'connect-src' currently permits https: + wss: + data: because users
    //     can paste arbitrary IIIF / image / GIF URLs (AnnotationForm).
    //     Once a per-share embedding-policy field exists we can scope this.
    //   - PUBLIC_MARTIN_URL is configurable per-deploy; covered by 'self'
    //     when proxied (default), or by the connect-src https: allowance.
    //   - openfreemap.org tiles are loaded by MapLibre from the browser —
    //     covered by connect-src/img-src https:.
    //   - MapLibre spawns blob: workers; permit worker-src blob:.
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'", 'https:', 'wss:', 'data:'],
        'worker-src': ["'self'", 'blob:'],
        'frame-ancestors': ["'self'"],
      },
    },

    // Surface build identity to the client for invalidation + diagnostics.
    // PUBLIC_BUILD_VERSION is injected by CI; falls back to build timestamp.
    version: { name: process.env.PUBLIC_BUILD_VERSION ?? new Date().toISOString() },
  },
};

export default config;
