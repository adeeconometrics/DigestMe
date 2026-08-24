import { cacheFirstArtifact, isPyodideArtifactRequest } from "./artifactCache";

interface LifecycleEvent {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends LifecycleEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}

interface ArtifactServiceWorkerScope {
  addEventListener(type: "install", listener: (event: LifecycleEvent) => void): void;
  addEventListener(type: "activate", listener: (event: LifecycleEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  caches: CacheStorage;
  clients: {
    claim(): Promise<void>;
  };
  fetch(request: Request): Promise<Response>;
  skipWaiting(): Promise<void>;
}

function isArtifactServiceWorkerScope(value: {}): value is ArtifactServiceWorkerScope {
  return "clients" in value && "skipWaiting" in value;
}

const scope = globalThis;
if (!isArtifactServiceWorkerScope(scope)) {
  throw new Error("Artifact service worker must run under a ServiceWorkerGlobalScope.");
}
const serviceWorkerScope: ArtifactServiceWorkerScope = scope;

serviceWorkerScope.addEventListener("install", (event) => {
  event.waitUntil(serviceWorkerScope.skipWaiting());
});

serviceWorkerScope.addEventListener("activate", (event) => {
  event.waitUntil(serviceWorkerScope.clients.claim());
});

serviceWorkerScope.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !isPyodideArtifactRequest(event.request)) return;

  event.respondWith(
    cacheFirstArtifact(event.request, {
      cacheStorage: serviceWorkerScope.caches,
      fetcher: (request) => serviceWorkerScope.fetch(request),
    }),
  );
});
