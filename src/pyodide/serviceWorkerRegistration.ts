const SERVICE_WORKER_READY_TIMEOUT_MS = 3000;

export async function registerPyodideServiceWorker(): Promise<void> {
  if (!("navigator" in globalThis) || !("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}pyodide-service-worker.js`, {
      scope: import.meta.env.BASE_URL,
      type: "module",
    });
    await Promise.race([
      navigator.serviceWorker.ready.then(() => undefined),
      new Promise<void>((resolve) => globalThis.setTimeout(resolve, SERVICE_WORKER_READY_TIMEOUT_MS)),
    ]);
  } catch {
    // The engine still has its direct network path when service workers are unavailable.
  }
}
