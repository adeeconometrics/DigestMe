import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenRouterModels, isOpenRouterModelId } from "../src/lib/openrouter";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouter model catalog", () => {
  it("parses and sorts valid public model entries without credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "zeta/model", name: "Zeta", context_length: 8_000 },
        { id: "alpha/model", name: "Alpha", description: "A model", context_length: 16_000 },
        { name: "Missing id" },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchOpenRouterModels()).resolves.toEqual([
      { id: "alpha/model", name: "Alpha", description: "A model", contextLength: 16_000 },
      { id: "zeta/model", name: "Zeta", contextLength: 8_000 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("headers.Authorization");
  });

  it("reports an unavailable catalog", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(fetchOpenRouterModels()).rejects.toThrow("OpenRouter returned 503");
  });
});

describe("OpenRouter model IDs", () => {
  it("accepts provider/model slugs and rejects incomplete values", () => {
    expect(isOpenRouterModelId("openai/gpt-4o-mini")).toBe(true);
    expect(isOpenRouterModelId("  anthropic/claude-sonnet ")).toBe(true);
    expect(isOpenRouterModelId("gpt-4o-mini")).toBe(false);
    expect(isOpenRouterModelId("/model")).toBe(false);
  });
});
