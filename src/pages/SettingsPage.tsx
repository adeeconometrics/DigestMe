import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Icon from "../components/Icon";
import { clearAgentApiKey, loadAgentSettings, saveAgentSettings, validateApiKey } from "../lib/agentSettings";
import type { AgentSettingsStatus } from "../lib/agentSettings";
import { fetchOpenRouterModels, isOpenRouterModelId } from "../lib/openrouter";
import type { OpenRouterModelOption } from "../lib/openrouter";
import { disposeEngine } from "../pyodide/engineLoader";
import { evictRuntimeStore, getRuntimeStoreStatus } from "../pyodide/runtimeStore";
import type { RuntimeStoreStatus } from "../pyodide/runtimeStore";
import { DEFAULT_OPENROUTER_MODEL } from "../types";

type CatalogStatus = "loading" | "ready" | "error";

interface SettingsPageProps {
  onBackToStudy: () => void;
}

function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

/** Provider settings for the browser-only case-digest agent. */
export default function SettingsPage({ onBackToStudy }: SettingsPageProps) {
  const [status, setStatus] = useState<AgentSettingsStatus | null>(null);
  const [draftModel, setDraftModel] = useState(DEFAULT_OPENROUTER_MODEL);
  const [modelFilter, setModelFilter] = useState("");
  const [models, setModels] = useState<OpenRouterModelOption[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>("loading");
  const [catalogError, setCatalogError] = useState("");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStoreStatus>("checking");
  const [runtimeError, setRuntimeError] = useState("");
  const [isReinstallingRuntime, setIsReinstallingRuntime] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadAgentSettings()
      .then((loaded) => {
        if (!mounted) return;
        setStatus(loaded);
        if (loaded.modelId) setDraftModel(loaded.modelId);
      })
      .catch(() => {
        if (mounted) setStatus({ modelId: "", hasApiKey: false });
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void getRuntimeStoreStatus().then((nextStatus) => {
      if (mounted) setRuntimeStatus(nextStatus);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchOpenRouterModels(controller.signal, catalogAttempt > 0 ? "reload" : "default")
      .then((loadedModels) => {
        if (controller.signal.aborted) return;
        setModels(loadedModels);
        setCatalogStatus("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) return;
        setCatalogStatus("error");
        setCatalogError(cause instanceof Error ? cause.message : "The OpenRouter model catalog could not be loaded.");
      });
    return () => controller.abort();
  }, [catalogAttempt]);

  const filter = modelFilter.trim().toLowerCase();
  const visibleModels = filter
    ? models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(filter))
    : models;
  const selectedCatalogModel = models.find((model) => model.id === draftModel);
  const options = selectedCatalogModel && !visibleModels.some((model) => model.id === selectedCatalogModel.id)
    ? [selectedCatalogModel, ...visibleModels]
    : visibleModels;
  const keyLoaded = Boolean(status?.hasApiKey);
  const catalogReady = catalogStatus === "ready" && models.length > 0;
  const manualModel = catalogStatus === "error" || (catalogStatus === "ready" && models.length === 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setSaved(false);
    const normalizedModel = draftModel.trim();
    if (!isOpenRouterModelId(normalizedModel)) {
      setError("Choose a model from the catalog or enter a provider/model ID.");
      return;
    }

    const keyError = apiKeyDraft ? validateApiKey(apiKeyDraft) : keyLoaded ? null : "Paste your OpenRouter API key.";
    if (keyError) {
      setError(keyError);
      return;
    }

    setIsSaving(true);
    try {
      const nextStatus = await saveAgentSettings(normalizedModel, apiKeyDraft);
      setStatus(nextStatus);
      setApiKeyDraft("");
      setShowApiKey(false);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemoveKey(): Promise<void> {
    if (!window.confirm("Remove the stored API key from this device?")) return;
    try {
      await clearAgentApiKey();
      setStatus((previous) => previous ? { ...previous, hasApiKey: false, apiKeyHint: undefined } : previous);
      setSaved(false);
    } catch {
      setError("The stored API key could not be removed.");
    }
  }

  async function handleReinstallRuntime(): Promise<void> {
    if (!window.confirm("Reinstall the agent runtime? In-flight agent runs will be stopped, and the local runtime cache will be removed.")) return;
    setRuntimeError("");
    setIsReinstallingRuntime(true);
    try {
      disposeEngine();
      await evictRuntimeStore();
      setRuntimeStatus("not-cached");
    } catch (cause: unknown) {
      setRuntimeStatus("error");
      setRuntimeError(cause instanceof Error ? cause.message : "The agent runtime could not be reinstalled.");
    } finally {
      setIsReinstallingRuntime(false);
    }
  }

  const runtimeStatusLabel = runtimeStatus === "checking"
    ? "checking runtime"
    : runtimeStatus === "cached"
      ? "runtime cached"
      : runtimeStatus === "not-cached"
        ? "installs on first run"
        : runtimeStatus === "unavailable"
          ? "local cache unavailable"
          : "runtime status unavailable";
  const runtimeStatusClass = runtimeStatus === "cached" ? "is-ready" : runtimeStatus === "error" || runtimeStatus === "unavailable" ? "is-error" : "";

  function retryCatalog(): void {
    setCatalogStatus("loading");
    setCatalogError("");
    setCatalogAttempt((attempt) => attempt + 1);
  }

  return (
    <div className="page settings-page">
      <section className="settings-hero">
        <div className="settings-hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> my study space</div>
          <h1>Set your <em>compass.</em></h1>
          <p>Choose the OpenRouter model that will guide your case-digest agent. Your connection stays browser-first.</p>
        </div>
        <div className="settings-hero-art" aria-hidden="true">
          <span className="settings-hero-orbit" />
          <span className="settings-hero-orbit inner" />
          <span className="settings-hero-mark"><Icon name="lock" size={23} /></span>
          <span className="settings-hero-stamp">openrouter / byok</span>
        </div>
      </section>

      <form className="settings-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="settings-grid">
          <section className="settings-card">
            <div className="settings-card-top"><span className="settings-step">01 / model</span><span className={`settings-card-status ${catalogStatus === "error" ? "is-error" : ""}`}><span className="settings-status-dot" />{catalogReady ? `${models.length} models` : catalogStatus === "loading" ? "loading catalog" : "catalog offline"}</span></div>
            <h2>Pick your <em>thinking partner.</em></h2>
            <p className="settings-card-intro">OpenRouter&apos;s public catalog is loaded without your credential. Pick a model by its provider/model ID.</p>

            {catalogReady && (
              <label className="settings-field settings-search-field">
                <span>Search the catalog</span>
                <input aria-label="Search OpenRouter models" onChange={(event) => setModelFilter(event.target.value)} placeholder="Filter by name or provider..." type="search" value={modelFilter} />
              </label>
            )}

            {!manualModel ? (
              <label className="settings-field" htmlFor="openrouter-model">
                <span>OpenRouter model</span>
                <select id="openrouter-model" onChange={(event) => setDraftModel(event.target.value)} value={draftModel}>
                  {draftModel && !models.some((model) => model.id === draftModel) && <option value={draftModel}>{draftModel} (saved)</option>}
                  {options.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
                </select>
              </label>
            ) : (
              <label className="settings-field settings-manual-model" htmlFor="manual-openrouter-model">
                <span>Model ID</span>
                <input id="manual-openrouter-model" onChange={(event) => setDraftModel(event.target.value)} placeholder="openai/gpt-4o-mini" spellCheck={false} value={draftModel} />
              </label>
            )}

            {selectedCatalogModel && (
              <div className="settings-model-meta">
                <strong>{selectedCatalogModel.name}</strong>
                {selectedCatalogModel.contextLength ? <span>{selectedCatalogModel.contextLength.toLocaleString()} token context</span> : <span>OpenRouter catalog model</span>}
                {selectedCatalogModel.description && <p>{selectedCatalogModel.description}</p>}
              </div>
            )}

            {catalogStatus === "loading" && <div className="settings-catalog-state"><span className="loading-orbit"><Icon name="spark" size={15} /></span><span>Loading the latest public model list...</span></div>}
            {catalogStatus === "error" && <div className="settings-catalog-state is-error"><span>{catalogError}</span><button className="text-button" onClick={retryCatalog} type="button">Try again <Icon name="refresh" size={13} /></button></div>}
            {catalogStatus === "ready" && !models.length && <div className="settings-catalog-state is-error"><span>No models were returned. Enter a model ID above.</span></div>}
          </section>

          <section className="settings-card settings-key-card">
            <div className="settings-card-top"><span className="settings-step">02 / credential</span><span className={`settings-card-status ${keyLoaded ? "is-ready" : ""}`}><span className="settings-status-dot" />{keyLoaded ? "key sealed" : "key needed"}</span></div>
            <h2>Bring your <em>own key.</em></h2>
            <p className="settings-card-intro">Paste an OpenRouter key to authorize the agent. It is sealed on this device and never included in the public model request.</p>

            {keyLoaded && (
              <div className="settings-key-status is-ready" role="status">
                <span className="settings-key-status-icon"><Icon name="check" size={14} /></span>
                <span>Stored securely · <code>sk-or-••••{status?.apiKeyHint ?? "····"}</code>{status?.savedAt && <small>saved {formatDate(status.savedAt)}</small>}</span>
                <button className="text-button" onClick={() => void handleRemoveKey()} type="button">Remove</button>
              </div>
            )}

            {!keyLoaded && <p className="settings-key-empty">No key stored yet. Create one at openrouter.ai/keys; it stays on this device.</p>}

            <label className="settings-field" htmlFor="openrouter-api-key">
              <span>{keyLoaded ? "Replace API key" : "OpenRouter API key"}</span>
              <div className="settings-secret-input">
                <input
                  autoComplete="off"
                  id="openrouter-api-key"
                  name="openrouter-api-key"
                  onChange={(event) => { setApiKeyDraft(event.target.value); setSaved(false); }}
                  placeholder="sk-or-v1-..."
                  spellCheck={false}
                  type={showApiKey ? "text" : "password"}
                  value={apiKeyDraft}
                />
                <button aria-label={showApiKey ? "Hide API key" : "Show API key"} className="secret-toggle" onClick={() => setShowApiKey((shown) => !shown)} type="button">{showApiKey ? "hide" : "show"}</button>
              </div>
            </label>

            {error && <p className="settings-form-error" role="alert">{error}</p>}
            <a className="settings-key-link" href="https://openrouter.ai/keys" rel="noreferrer" target="_blank">Create or revoke a key <Icon name="arrow-right" size={13} /></a>
          </section>

          <section className="settings-card settings-runtime-card">
            <div className="settings-card-top"><span className="settings-step">03 / runtime</span><span className={`settings-card-status ${runtimeStatusClass}`}><span className="settings-status-dot" />{runtimeStatusLabel}</span></div>
            <h2>Keep your <em>runtime close.</em></h2>
            <p className="settings-card-intro">The agent dependencies are cached in a version-keyed local store after the first verified install. If storage is unavailable, the agent still installs ephemerally.</p>
            <div className="settings-runtime-controls">
              <button className="primary-button settings-runtime-action" disabled={isReinstallingRuntime} onClick={() => void handleReinstallRuntime()} type="button"><Icon name="refresh" size={15} />{isReinstallingRuntime ? "Reinstalling..." : "Reinstall agent runtime"}</button>
              <span className="settings-runtime-note">Only the dependency store is removed. Your artifact cache stays intact.</span>
            </div>
            {runtimeError && <p className="settings-form-error" role="alert">{runtimeError}</p>}
          </section>
        </div>

        <section className="settings-security">
          <span className="settings-security-icon"><Icon name="lock" size={20} /></span>
          <div className="settings-security-copy">
            <span className="settings-step">privacy, by default</span>
            <h2>Your key stays close.</h2>
            <p>The key is encrypted with AES-GCM under a non-exportable device key. Only the ciphertext is stored locally; plaintext is opened briefly for the agent call. No client-side scheme can protect against an actively compromised page, so use a revocable, spend-limited key.</p>
          </div>
          <ul className="settings-security-list">
            <li><Icon name="check" size={14} />No plaintext key in localStorage, URLs, or logs</li>
            <li><Icon name="check" size={14} />No credential on the public model-list request</li>
            <li><Icon name="check" size={14} />Document context goes directly to OpenRouter when called</li>
          </ul>
        </section>

        <div className="settings-footer">
          <span className="settings-footer-note"><Icon name={keyLoaded ? "check" : "lock"} size={15} />{keyLoaded ? "Ready for the case-digest agent" : "Add a key before running the agent"}</span>
          <div className="settings-footer-actions">
            {saved && <span className="settings-save-state" role="status">Connection saved</span>}
            <button className="text-button" onClick={onBackToStudy} type="button">Back to study</button>
            <button className="primary-button" disabled={isSaving || !draftModel.trim()} type="submit"><Icon name="check" size={16} />{isSaving ? "Sealing..." : "Save connection"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
