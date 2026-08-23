import { describe, expect, it, vi } from "vitest";
import {
  cacheFirstArtifact,
  isPyodideArtifactRequest,
  PYODIDE_CACHE_NAME,
  PYODIDE_INDEX_URL,
} from "../src/pyodide/artifactCache";

class MemoryCache {
  private readonly entries = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.entries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, response.clone());
  }
}

describe("isPyodideArtifactRequest", () => {
  it("recognizes the runtime, package metadata, and wheel URLs", () => {
    expect(isPyodideArtifactRequest(`${PYODIDE_INDEX_URL}pyodide.asm.wasm`)).toBe(true);
    expect(isPyodideArtifactRequest("https://pypi.org/pypi/pydantic-ai-slim/2.33.0/json")).toBe(true);
    expect(
      isPyodideArtifactRequest(
        "https://files.pythonhosted.org/packages/ab/cd/example-1.0.0-py3-none-any.whl",
      ),
    ).toBe(true);
    expect(isPyodideArtifactRequest("https://pypi.org/packages/example-1.0.0.tar.gz")).toBe(true);
  });

  it("does not cache unrelated application or model requests", () => {
    expect(isPyodideArtifactRequest("https://pypi.org/project/pydantic-ai-slim/")).toBe(false);
    expect(isPyodideArtifactRequest("https://pypi.org/packages/example-1.0.0.txt")).toBe(false);
    expect(isPyodideArtifactRequest("https://openrouter.ai/api/v1/models")).toBe(false);
    expect(isPyodideArtifactRequest("https://cdn.jsdelivr.net/npm/react/index.js")).toBe(false);
  });
});

describe("cacheFirstArtifact", () => {
  it("fetches a cache miss, stores it, and reuses it on the next session request", async () => {
    const cache = new MemoryCache();
    const fetcher = vi.fn(async () => new Response("wasm artifact"));
    const cacheStorage = {
      open: vi.fn(async (cacheName: string) => {
        expect(cacheName).toBe(PYODIDE_CACHE_NAME);
        return cache;
      }),
    };
    const request = new Request(`${PYODIDE_INDEX_URL}pyodide.asm.wasm`);

    const firstResponse = await cacheFirstArtifact(request, { cacheStorage, fetcher });
    expect(firstResponse.status).toBe(200);
    const secondResponse = await cacheFirstArtifact(request, { cacheStorage, fetcher });
    expect(await secondResponse.text()).toBe("wasm artifact");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cacheStorage.open).toHaveBeenCalledTimes(2);
  });

  it("falls back to the network when Cache Storage cannot be opened", async () => {
    const fetcher = vi.fn(async () => new Response("fresh artifact"));
    const cacheStorage = {
      open: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
    };

    const response = await cacheFirstArtifact(
      new Request(`${PYODIDE_INDEX_URL}python_stdlib.zip`),
      { cacheStorage, fetcher },
    );
    expect(await response.text()).toBe("fresh artifact");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
