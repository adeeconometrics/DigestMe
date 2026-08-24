import { loadPyodide } from "pyodide";
import type { PyodideAPI } from "pyodide";
import bridgeSource from "../engine/bridge.py?raw";
import initSource from "../engine/__init__.py?raw";
import agentSource from "../engine/agent.py?raw";
import documentSource from "../engine/document.py?raw";
import schemasSource from "../engine/schemas.py?raw";
import searchSource from "../engine/search.py?raw";
import toolsSource from "../engine/tools.py?raw";
import type { WireValue } from "../types";
import { isWireString, isWireValue } from "../types";
import { PYODIDE_INDEX_URL } from "./artifactCache";
import { createRequestRegistry } from "./requestRegistry";
import { createRequestScheduler } from "./requestScheduler";

interface WorkerRunRequest {
  requestId: number;
  command: "chat" | "digest";
  root: unknown;
  question?: string;
  stream?: boolean;
  modelId: string;
  apiKey: string;
}

interface WorkerCancelRequest {
  requestId: number;
  command: "cancel";
}

type WorkerRequest = WorkerRunRequest | WorkerCancelRequest;

interface WorkerResponse {
  type: "status" | "stream" | "result" | "error" | "heartbeat" | "started";
  requestId?: number;
  state?: "idle" | "loading" | "ready" | "failed";
  message?: string;
  event?: WireValue;
  result?: WireValue;
}

const ENGINE_ROOT = "/tmp/digest-engine";
const ENGINE_SOURCES = {
  "__init__.py": initSource,
  "agent.py": agentSource,
  "bridge.py": bridgeSource,
  "document.py": documentSource,
  "schemas.py": schemasSource,
  "search.py": searchSource,
  "tools.py": toolsSource,
} satisfies Record<string, string>;

// SAFETY: this module is bundled only as the engine Worker's entry, where globalThis carries the onmessage/postMessage contract declared below.
const workerScope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

let pyodidePromise: Promise<PyodideAPI> | undefined;
const requestRegistry = createRequestRegistry();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.command !== "string") return false;
  if (value.command === "cancel") return true;
  if (value.command !== "chat" && value.command !== "digest") return false;
  if (!("root" in value) || typeof value.modelId !== "string" || typeof value.apiKey !== "string") return false;
  if (value.question !== undefined && typeof value.question !== "string") return false;
  return value.stream === undefined || typeof value.stream === "boolean";
}

function postStatus(state: WorkerResponse["state"], message?: string): void {
  const status: WorkerResponse = { type: "status", state };
  if (message) status.message = message;
  workerScope.postMessage(status);
}

function summarizeError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : "The case-digest agent failed.";
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const summary = [...lines].reverse().find((line) => /^[\w.]+(?:Error|Exception):\s/.test(line)) ?? lines[lines.length - 1];
  if (!summary) return "The case-digest agent failed.";
  return summary.length > 240 ? `${summary.slice(0, 237)}...` : summary;
}

function writeEngineSources(pyodide: PyodideAPI): void {
  pyodide.FS.mkdirTree(`${ENGINE_ROOT}/engine`);
  for (const [fileName, source] of Object.entries(ENGINE_SOURCES)) {
    pyodide.FS.writeFile(`${ENGINE_ROOT}/engine/${fileName}`, source);
  }
}

async function loadEngine(): Promise<PyodideAPI> {
  postStatus("loading", "Loading the Python runtime...");
  const pyodide = await loadPyodide({
    indexURL: PYODIDE_INDEX_URL,
    packages: ["micropip"],
    stdout: () => undefined,
    stderr: () => undefined,
  });

  postStatus("loading", "Installing the case-digest agent...");
  await pyodide.runPythonAsync(`
import micropip
await micropip.install(["httpcore2==2.12.0", "pydantic-ai-slim[openrouter]==2.33.0"])
`);
  writeEngineSources(pyodide);
  await pyodide.runPythonAsync(`
import sys
sys.path.insert(0, ${JSON.stringify(ENGINE_ROOT)})
from engine.bridge import run_request, run_request_stream
`);
  pyodide.globals.set("emit_stream", dispatchStream);
  postStatus("ready");
  return pyodide;
}

function getEngine(): Promise<PyodideAPI> {
  pyodidePromise ??= loadEngine().catch((cause: unknown) => {
    const message = summarizeError(cause);
    postStatus("failed", message);
    pyodidePromise = undefined;
    throw cause;
  });
  return pyodidePromise;
}

/**
 * Cadence for liveness pings while a request is executing.
 *
 * Non-streaming digest runs can stay silent for minutes inside a single LLM
 * call; the loader uses these pings to tell "busy" apart from "hung" so its
 * inactivity timer does not kill healthy work (see engineLoader.ts).
 */
const HEARTBEAT_INTERVAL_MS = 20_000;

let activeRequests = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

function dispatchStream(requestId: number, event: unknown): void {
  const eventJson = isWireString(event) ? event : String(event);
  const parsed: unknown = JSON.parse(eventJson);
  if (!isWireValue(parsed)) throw new Error("The agent stream returned an invalid event.");
  requestRegistry.dispatch(requestId, parsed);
}

function setActiveRequests(count: number): void {
  activeRequests = count;
  if (activeRequests > 0 && heartbeatTimer === undefined) {
    heartbeatTimer = setInterval(() => workerScope.postMessage({ type: "heartbeat" }), HEARTBEAT_INTERVAL_MS);
  } else if (activeRequests === 0 && heartbeatTimer !== undefined) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

async function execute(request: WorkerRunRequest, isCancelled: () => boolean): Promise<WireValue | undefined> {
  const pyodide = await getEngine();
  if (isCancelled()) return undefined;
  const payload = JSON.stringify({
    command: request.command,
    root: request.root,
    question: request.question,
    model_name: request.modelId,
    api_key: request.apiKey,
  });
  requestRegistry.register(request.requestId, {
    payload,
    onStream: request.stream
      ? (event: WireValue) => workerScope.postMessage({ type: "stream", requestId: request.requestId, event })
      : undefined,
  });
  try {
    if (isCancelled()) return undefined;
    const pythonCall = request.stream
      ? `await run_request_stream(${JSON.stringify(payload)}, ${request.requestId}, emit_stream)`
      : `await run_request(${JSON.stringify(payload)}, ${request.requestId})`;
    const result = await pyodide.runPythonAsync(pythonCall);
    if (isCancelled()) return undefined;
    return JSON.parse(String(result));
  } finally {
    requestRegistry.remove(request.requestId);
  }
}

const MAX_CONCURRENT_REQUESTS = 2;
const requestScheduler = createRequestScheduler<WorkerRunRequest>(MAX_CONCURRENT_REQUESTS, async (request, isCancelled) => {
  if (isCancelled()) return;
  workerScope.postMessage({ type: "started", requestId: request.requestId });
  setActiveRequests(activeRequests + 1);
  try {
    const result = await execute(request, isCancelled);
    if (!isCancelled() && result !== undefined) {
      workerScope.postMessage({ type: "result", requestId: request.requestId, result });
    }
  } catch (error) {
    if (!isCancelled()) {
      const message = summarizeError(error);
      workerScope.postMessage({ type: "error", requestId: request.requestId, message });
    }
  } finally {
    setActiveRequests(activeRequests - 1);
  }
});

workerScope.onmessage = (event) => {
  const request = event.data;
  if (!isWorkerRequest(request)) return;
  if (request.command === "cancel") {
    requestRegistry.remove(request.requestId);
    requestScheduler.cancel(request.requestId);
    return;
  }
  requestScheduler.enqueue({ requestId: request.requestId, value: request });
};
