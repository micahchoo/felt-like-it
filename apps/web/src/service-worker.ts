/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Minimal app-shell service worker for FLIT.
// - Precaches the SvelteKit build artifacts + static assets at install
// - Cache-first for hashed build assets (immutable)
// - Stale-while-revalidate for static, navigation requests fall through to network
// - All API/tRPC/dynamic routes bypass the worker (network only)
//
// Intentionally minimal: no offline page, no background sync. The manifest
// declares install intent (display:standalone); this worker makes that real
// without trying to be fully offline-capable.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `flit-cache-${version}`;
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only; cross-origin tiles/APIs go straight to network.
  if (url.origin !== sw.location.origin) return;

  // Never cache server routes — APIs, tRPC, server-side endpoints.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/trpc/') ||
    url.pathname.startsWith('/auth/')
  ) {
    return;
  }

  // Hashed build artifacts are immutable — cache-first.
  if (build.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Static files — stale-while-revalidate.
  if (files.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Navigations and everything else — network, fall back to cache only on failure.
  event.respondWith(networkFirst(request));
});

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const networkPromise = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit ?? (await networkPromise) ?? new Response('', { status: 504 });
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    throw new Error('offline and no cache');
  }
}
