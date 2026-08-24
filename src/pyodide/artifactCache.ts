export const PYODIDE_VERSION = "v314.0.5";
export const AGENT_VERSION = "pydantic-ai-2.33.0-httpcore2-2.12.0";
export const PYODIDE_RUNTIME_KEY = `${PYODIDE_VERSION}-${AGENT_VERSION}`;
export const PYODIDE_RUNTIME_DB_NAME = `/digest-me-runtime-${PYODIDE_RUNTIME_KEY}`;
export const PYODIDE_RUNTIME_MARKER_FILE = ".digest-me-runtime-version";
export const PYODIDE_RUNTIME_MARKER_VALUE = PYODIDE_RUNTIME_KEY;

export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;
export const PYODIDE_CACHE_NAME = `digest-me-pyodide-${PYODIDE_RUNTIME_KEY}`;

const PYODIDE_PATH_PREFIX = new URL(PYODIDE_INDEX_URL).pathname;
const PYPI_ORIGIN = "https://pypi.org";
const PYPI_FILES_ORIGIN = "https://files.pythonhosted.org";

interface ArtifactCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface ArtifactCacheStorage {
  open(cacheName: string): Promise<ArtifactCache>;
}

export interface ArtifactCacheDependencies {
  cacheStorage?: ArtifactCacheStorage;
  fetcher?: (request: Request) => Promise<Response>;
}

function isRequestString(value: Request | URL | string): value is string {
  return typeof value === "string";
}

function requestUrl(request: Request | URL | string): URL {
  if (isRequestString(request)) return new URL(request);
  if (request instanceof URL) return request;
  return new URL(request.url);
}

export function isPyodideArtifactRequest(request: Request | URL | string): boolean {
  const url = requestUrl(request);
  if (url.origin === "https://cdn.jsdelivr.net") {
    return url.pathname.startsWith(PYODIDE_PATH_PREFIX);
  }

  if (url.origin === PYPI_ORIGIN) {
    return (
      url.pathname.startsWith("/pypi/") ||
      url.pathname.startsWith("/simple/") ||
      (url.pathname.startsWith("/packages/") && /\.(?:whl|tar\.gz|zip)$/.test(url.pathname))
    );
  }

  return (
    url.origin === PYPI_FILES_ORIGIN &&
    url.pathname.startsWith("/packages/") &&
    /\.(?:whl|tar\.gz|zip)$/.test(url.pathname)
  );
}

export async function cacheFirstArtifact(
  request: Request,
  dependencies: ArtifactCacheDependencies = {},
): Promise<Response> {
  const fetcher = dependencies.fetcher ?? ((input: Request) => globalThis.fetch(input));
  const cacheStorage = dependencies.cacheStorage ?? globalThis.caches;
  if (!cacheStorage) return fetcher(request);

  let cache: ArtifactCache;
  try {
    cache = await cacheStorage.open(PYODIDE_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    return fetcher(request);
  }

  const response = await fetcher(request);
  if (!response.ok) return response;

  try {
    await cache.put(request, response.clone());
  } catch {
    return response;
  }
  return response;
}
