import { isWireNumber, isWireString, type WireValue } from "../types";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export interface OpenRouterModelOption {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
}

function isRecord(value: WireValue): value is Record<string, WireValue> {
  return typeof value === "object" && value !== null;
}

function parseModel(value: WireValue): OpenRouterModelOption | null {
  if (!isRecord(value)) return null;

  if (!isWireString(value.id) || !value.id.trim()) return null;

  const option: OpenRouterModelOption = {
    id: value.id,
    name: isWireString(value.name) && value.name.trim() ? value.name : value.id,
  };
  if (isWireString(value.description) && value.description.trim()) option.description = value.description;
  if (isWireNumber(value.context_length) && Number.isFinite(value.context_length)) {
    option.contextLength = value.context_length;
  }
  return option;
}

/** Return true for the provider/model slug accepted by Pydantic AI's OpenRouter model. */
export function isOpenRouterModelId(value: string): boolean {
  const [provider, model] = value.trim().split("/", 2);
  return Boolean(provider && model);
}

/** Load the public OpenRouter catalog without sending an API key. */
export async function fetchOpenRouterModels(signal?: AbortSignal, cache: RequestCache = "default"): Promise<OpenRouterModelOption[]> {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    cache,
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`OpenRouter returned ${response.status} while loading models.`);

  let payload: WireValue;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OpenRouter returned an unreadable model catalog.");
  }

  if (!isRecord(payload)) throw new Error("OpenRouter returned an invalid model catalog.");
  const data = payload.data;
  if (!Array.isArray(data)) throw new Error("OpenRouter returned an invalid model catalog.");

  return data
    .map(parseModel)
    .filter((model): model is OpenRouterModelOption => model !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
