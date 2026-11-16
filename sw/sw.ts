/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ATTACHMENT_CACHE } from "../shared/cache";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] };

void self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// App shell for every in-app URL. The API is never cached here: trip data lives in IndexedDB,
// and a second cached copy of API responses would disagree with it.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

// Attachments never change once uploaded (a new file gets a new id), so a cached copy is
// always correct and lets tickets open offline. The cache is wiped on logout.
registerRoute(
  ({ url, request }) => request.method === "GET" && url.origin === self.location.origin && /^\/api\/attachments\/[^/]+$/.test(url.pathname),
  new CacheFirst({ cacheName: ATTACHMENT_CACHE }),
);
