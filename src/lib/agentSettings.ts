import { getMetaValue, putMetaValue } from "./db";
import { isOpenRouterModelId } from "./openrouter";

const CRYPTO_KEY_ID = "agent-crypto-key";
const SETTINGS_ID = "agent-settings";
const OPENROUTER_KEY_PREFIX = "sk-or-";

/** AES-GCM payload with a fresh initialization vector for each saved key. */
export interface SealedSecret {
  iv: number[];
  ciphertext: number[];
}

/** Non-secret settings summary safe to render in the settings page. */
export interface AgentSettingsStatus {
  modelId: string;
  hasApiKey: boolean;
  /** Last four characters of the key, for recognition only. */
  apiKeyHint?: string;
  savedAt?: string;
}

interface StoredAgentSettings {
  modelId: string;
  sealedApiKey?: SealedSecret;
  apiKeyHint?: string;
  savedAt?: string;
}

/** Credentials consumed by the pydantic-agent bridge for one request. */
export interface AgentRuntimeCredentials {
  modelId: string;
  apiKey: string;
}

/** Validate the format without sending the key to any service. */
export function validateApiKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter your OpenRouter API key.";
  if (!trimmed.startsWith(OPENROUTER_KEY_PREFIX)) return `OpenRouter keys start with "${OPENROUTER_KEY_PREFIX}".`;
  if (trimmed.length < 20) return "That key looks too short to be an OpenRouter key.";
  return null;
}

/** Return a recognition-only suffix; the key itself never enters a status object. */
export function maskKeySuffix(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length >= 4 ? trimmed.slice(-4) : "";
}

export function normalizeModelId(raw: string): string {
  return raw.trim();
}

async function getSubtle(): Promise<SubtleCrypto> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is unavailable in this browser.");
  return subtle;
}

/** Create or retrieve a non-exportable device key used only for local encryption. */
async function getOrCreateWrappingKey(subtle: SubtleCrypto): Promise<CryptoKey> {
  const existing = await getMetaValue<CryptoKey>(CRYPTO_KEY_ID);
  if (existing) return existing;

  const key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await putMetaValue(CRYPTO_KEY_ID, key);
  return key;
}

export async function sealWithKey(key: CryptoKey, subtle: SubtleCrypto, plaintext: string): Promise<SealedSecret> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) throw new Error("WebCrypto is unavailable in this browser.");
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
}

export async function openWithKey(key: CryptoKey, subtle: SubtleCrypto, sealed: SealedSecret): Promise<string> {
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(sealed.iv) },
    key,
    new Uint8Array(sealed.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

/** Load only non-secret metadata for the settings UI. */
export async function loadAgentSettings(): Promise<AgentSettingsStatus> {
  const stored = await getMetaValue<StoredAgentSettings>(SETTINGS_ID);
  return {
    modelId: stored?.modelId ?? "",
    hasApiKey: Boolean(stored?.sealedApiKey),
    ...(stored?.apiKeyHint ? { apiKeyHint: stored.apiKeyHint } : {}),
    ...(stored?.savedAt ? { savedAt: stored.savedAt } : {}),
  };
}

/** Persist a model and seal a newly supplied key; an empty key preserves the old one. */
export async function saveAgentSettings(modelId: string, apiKey = ""): Promise<AgentSettingsStatus> {
  const normalizedModel = normalizeModelId(modelId);
  if (!isOpenRouterModelId(normalizedModel)) throw new Error("Pick an OpenRouter provider/model before saving.");

  const stored = await getMetaValue<StoredAgentSettings>(SETTINGS_ID);
  const next: StoredAgentSettings = {
    modelId: normalizedModel,
    savedAt: new Date().toISOString(),
    ...(stored?.sealedApiKey && !apiKey ? { sealedApiKey: stored.sealedApiKey } : {}),
    ...(stored?.apiKeyHint && !apiKey ? { apiKeyHint: stored.apiKeyHint } : {}),
  };

  if (apiKey) {
    const error = validateApiKey(apiKey);
    if (error) throw new Error(error);
    const subtle = await getSubtle();
    const wrappingKey = await getOrCreateWrappingKey(subtle);
    next.sealedApiKey = await sealWithKey(wrappingKey, subtle, apiKey.trim());
    next.apiKeyHint = maskKeySuffix(apiKey);
  }

  if (!next.sealedApiKey) throw new Error("Add your OpenRouter API key before saving.");
  await putMetaValue(SETTINGS_ID, next);

  return {
    modelId: next.modelId,
    hasApiKey: true,
    ...(next.apiKeyHint ? { apiKeyHint: next.apiKeyHint } : {}),
    ...(next.savedAt ? { savedAt: next.savedAt } : {}),
  };
}

/** Remove the sealed credential while retaining the selected model. */
export async function clearAgentApiKey(): Promise<void> {
  const stored = await getMetaValue<StoredAgentSettings>(SETTINGS_ID);
  if (!stored?.sealedApiKey && !stored?.apiKeyHint) return;
  await putMetaValue(SETTINGS_ID, {
    modelId: stored.modelId,
    ...(stored.savedAt ? { savedAt: stored.savedAt } : {}),
  });
}

/** Decrypt credentials immediately before a bridge call; callers must not cache the result. */
export async function getAgentRuntimeCredentials(): Promise<AgentRuntimeCredentials | null> {
  const stored = await getMetaValue<StoredAgentSettings>(SETTINGS_ID);
  if (!stored?.sealedApiKey) return null;

  const subtle = await getSubtle();
  const wrappingKey = await getMetaValue<CryptoKey>(CRYPTO_KEY_ID);
  if (!wrappingKey) return null;

  try {
    const apiKey = await openWithKey(wrappingKey, subtle, stored.sealedApiKey);
    return { modelId: stored.modelId, apiKey };
  } catch {
    return null;
  }
}
