import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: {url: string; revision: string | null}[] }
self.skipWaiting()
clientsClaim()
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/health(?:\/|$)/, /^\/api\//, /^\/offline\//] }))
registerRoute(({url}) => /(ytimg\.com|ggpht\.com|googleusercontent\.com)$/.test(url.hostname), new CacheFirst({cacheName:'thumbs', plugins:[new ExpirationPlugin({maxEntries:200,maxAgeSeconds:30*86400}),new CacheableResponsePlugin({statuses:[0,200]})]}))
registerRoute(({url}) => /\/api\/v1\/audio\/(search|related)/.test(url.pathname), new NetworkFirst({cacheName:'api',networkTimeoutSeconds:4,plugins:[new ExpirationPlugin({maxEntries:100,maxAgeSeconds:7*86400})]}))
