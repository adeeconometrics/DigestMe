import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAgentApiKey,
  getAgentRuntimeCredentials,
  loadAgentSettings,
  saveAgentSettings,
} from "../src/lib/agentSettings";
import { getMetaValue, removeMetaValue } from "../src/lib/db";

const CRYPTO_KEY_ID = "agent-crypto-key";
const SETTINGS_ID = "agent-settings";

describe("agent settings persistence", () => {
  beforeEach(async () => {
    await removeMetaValue(SETTINGS_ID);
    await removeMetaValue(CRYPTO_KEY_ID);
  });

  it("starts unconfigured", async () => {
    await expect(loadAgentSettings()).resolves.toEqual({ modelId: "", hasApiKey: false });
    await expect(getAgentRuntimeCredentials()).resolves.toBeNull();
  });

  it("seals and re-opens the key without storing plaintext", async () => {
    const apiKey = "sk-or-v1-persisted-secret";
    await saveAgentSettings("openai/gpt-4o-mini", apiKey);

    const status = await loadAgentSettings();
    expect(status).toMatchObject({ modelId: "openai/gpt-4o-mini", hasApiKey: true, apiKeyHint: "cret" });
    await expect(getAgentRuntimeCredentials()).resolves.toEqual({ modelId: "openai/gpt-4o-mini", apiKey });

    const stored = await getMetaValue<unknown>(SETTINGS_ID);
    expect(JSON.stringify(stored)).not.toContain(apiKey);
  });

  it("updates the model without requiring the key again", async () => {
    await saveAgentSettings("openai/gpt-4o-mini", "sk-or-v1-first-key-value");
    await saveAgentSettings("anthropic/claude-sonnet-4");

    await expect(getAgentRuntimeCredentials()).resolves.toEqual({
      modelId: "anthropic/claude-sonnet-4",
      apiKey: "sk-or-v1-first-key-value",
    });
  });

  it("rejects saving without a key and clears only the credential", async () => {
    await expect(saveAgentSettings("openai/gpt-4o-mini", "")).rejects.toThrow(/api key/i);
    await expect(saveAgentSettings("", "sk-or-v1-abcdef1234567890")).rejects.toThrow(/model/i);

    await saveAgentSettings("openai/gpt-4o-mini", "sk-or-v1-to-be-removed");
    await clearAgentApiKey();
    await expect(loadAgentSettings()).resolves.toMatchObject({ modelId: "openai/gpt-4o-mini", hasApiKey: false });
    await expect(getAgentRuntimeCredentials()).resolves.toBeNull();
  });
});
