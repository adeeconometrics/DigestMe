import { describe, expect, it } from "vitest";
import { maskKeySuffix, normalizeModelId, openWithKey, sealWithKey, validateApiKey } from "../src/lib/agentSettings";

const subtle = globalThis.crypto.subtle;

async function makeKey(): Promise<CryptoKey> {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

describe("validateApiKey", () => {
  it("accepts a well-formed OpenRouter key", () => {
    expect(validateApiKey("sk-or-v1-abcdef1234567890abcdef")).toBeNull();
  });

  it("rejects empty, foreign, and short keys", () => {
    expect(validateApiKey("   ")).toMatch(/enter/i);
    expect(validateApiKey("sk-proj-abcdefghijklmnop")).toMatch(/sk-or-/);
    expect(validateApiKey("sk-or-x")).toMatch(/too short/i);
  });
});

describe("key sealing", () => {
  it("round-trips without persisting plaintext and uses a fresh IV", async () => {
    const key = await makeKey();
    const apiKey = "sk-or-v1-supersecretvalue";
    const first = await sealWithKey(key, subtle, apiKey);
    const second = await sealWithKey(key, subtle, apiKey);

    expect(JSON.stringify(first)).not.toContain(apiKey);
    expect(first.iv).toHaveLength(12);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    await expect(openWithKey(key, subtle, first)).resolves.toBe(apiKey);
  });

  it("rejects a ciphertext opened with the wrong key", async () => {
    const [rightKey, wrongKey] = await Promise.all([makeKey(), makeKey()]);
    const sealed = await sealWithKey(rightKey, subtle, "sk-or-v1-secret");

    await expect(openWithKey(wrongKey, subtle, sealed)).rejects.toThrow();
  });
});

describe("settings helpers", () => {
  it("normalizes the model and masks only the key suffix", () => {
    expect(normalizeModelId("  OpenAI/GPT-4o-Mini ")).toBe("OpenAI/GPT-4o-Mini");
    expect(maskKeySuffix("sk-or-v1-abcd1234wxyz")).toBe("wxyz");
    expect(maskKeySuffix("abc")).toBe("");
  });
});
