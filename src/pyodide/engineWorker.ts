import { loadPyodide } from "pyodide";
import type { PyodideAPI } from "pyodide";
import bridgeSource from "../engine/bridge.py?raw";
import initSource from "../engine/__init__.py?raw";
import agentSource from "../engine/agent.py?raw";
import documentSource from "../engine/document.py?raw";
import schemasSource from "../engine/schemas.py?raw";
import searchSource from "../engine/search.py?raw";
import toolsSource from "../engine/tools.py?raw";
import { PYODIDE_INDEX_URL } from "./artifactCache";

interface WorkerRequest {
  requestId: number;
  command: "chat" | "digest";
  root: unknown;
  question?: string;
  stream?: boolean;
  modelId: string;
  apiKey: string;
}

interface WorkerResponse {
  type: "status" | "stream" | "result" | "error" | "heartbeat" | "started";
  requestId?: number;
  state?: "idle" | "loading" | "ready" | "failed";
  message?: string;
  event?: unknown;
  result?: unknown;
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

const workerScope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

let pyodidePromise: Promise<PyodideAPI> | undefined;

function postStatus(state: WorkerResponse["state"], message?: string): void {
  workerScope.postMessage({ type: "status", state, ...(message ? { message } : {}) });
}

function summarizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "The case-digest agent failed.";
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
  postStatus("ready");
  return pyodide;
}

function getEngine(): Promise<PyodideAPI> {
  pyodidePromise ??= loadEngine().catch((error: unknown) => {
    const message = summarizeError(error);
    postStatus("failed", message);
    pyodidePromise = undefined;
    throw error;
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

function setActiveRequests(count: number): void {
  activeRequests = count;
  if (activeRequests > 0 && heartbeatTimer === undefined) {
    heartbeatTimer = setInterval(() => workerScope.postMessage({ type: "heartbeat" }), HEARTBEAT_INTERVAL_MS);
  } else if (activeRequests === 0 && heartbeatTimer !== undefined) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

async function execute(request: WorkerRequest): Promise<unknown> {
  const pyodide = await getEngine();
  const payload = JSON.stringify({
    command: request.command,
    root: request.root,
    question: request.question,
    model_name: request.modelId,
    api_key: request.apiKey,
  });
  pyodide.globals.set("request_payload", payload);
  const streamCallback = request.stream
    ? (event: unknown) => {
        const eventJson = typeof event === "string" ? event : String(event);
        workerScope.postMessage({
          type: "stream",
          requestId: request.requestId,
          event: JSON.parse(eventJson),
        });
      }
    : undefined;
  if (streamCallback) pyodide.globals.set("stream_callback", streamCallback);
  try {
    const pythonCall = request.stream
      ? "await run_request_stream(request_payload, stream_callback)"
      : "await run_request(request_payload)";
    const result = await pyodide.runPythonAsync(pythonCall);
    return JSON.parse(String(result));
  } finally {
    pyodide.runPython("request_payload = None\nstream_callback = None");
  }
}

let requestChain = Promise.resolve();
workerScope.onmessage = (event) => {
  const request = event.data;
  requestChain = requestChain.then(async () => {
    // Acknowledge the hand-off so the loader starts this request's inactivity
    // timer only now — queued requests must not tick while they wait.
    workerScope.postMessage({ type: "started", requestId: request.requestId });
    setActiveRequests(activeRequests + 1);
    try {
      const result = await execute(request);
      workerScope.postMessage({ type: "result", requestId: request.requestId, result });
    } catch (error) {
      const message = summarizeError(error);
      workerScope.postMessage({ type: "error", requestId: request.requestId, message });
    } finally {
      setActiveRequests(activeRequests - 1);
    }
  });
};
