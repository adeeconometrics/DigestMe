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

const serviceWorkerScope = globalThis as unknown as ArtifactServiceWorkerScope;

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
