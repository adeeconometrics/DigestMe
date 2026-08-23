import { loadPyodide } from "pyodide";
import type { PyodideAPI } from "pyodide";
import bridgeSource from "../engine/bridge.py?raw";
import initSource from "../engine/__init__.py?raw";
import agentSource from "../engine/agent.py?raw";
import documentSource from "../engine/document.py?raw";
import schemasSource from "../engine/schemas.py?raw";
import searchSource from "../engine/search.py?raw";
import toolsSource from "../engine/tools.py?raw";

interface WorkerRequest {
  requestId: number;
  command: "chat" | "digest" | "stream-probe";
  root: unknown;
  question?: string;
  modelId: string;
  apiKey: string;
}

interface WorkerResponse {
  type: "status" | "result" | "stream" | "error";
  requestId?: number;
  state?: "idle" | "loading" | "ready" | "failed";
  message?: string;
  event?: unknown;
  result?: unknown;
}

const ENGINE_ROOT = "/tmp/digest-engine";
const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.5/full/";
const ENGINE_SOURCES: Record<string, string> = {
  "__init__.py": initSource,
  "agent.py": agentSource,
  "bridge.py": bridgeSource,
  "document.py": documentSource,
  "schemas.py": schemasSource,
  "search.py": searchSource,
  "tools.py": toolsSource,
};

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
from engine.bridge import run_request
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

async function execute(request: WorkerRequest): Promise<unknown> {
  const pyodide = await getEngine();
  if (request.command === "stream-probe") {
    return executeStreamProbe(pyodide, request);
  }

  const payload = JSON.stringify({
    command: request.command,
    root: request.root,
    question: request.question,
    model_name: request.modelId,
    api_key: request.apiKey,
  });
  pyodide.globals.set("request_payload", payload);
  try {
    const result = await pyodide.runPythonAsync("await run_request(request_payload)");
    return JSON.parse(String(result));
  } finally {
    pyodide.runPython("request_payload = None");
  }
}

// Temporary Phase 0 probe: remove after verifying that run_stream chunks cross
// the Pyodide worker boundary as separate postMessage events.
async function executeStreamProbe(pyodide: PyodideAPI, request: WorkerRequest): Promise<unknown> {
  pyodide.globals.set("stream_probe_payload", JSON.stringify({ root: request.root }));
  pyodide.globals.set("stream_probe_emit", (eventJson: string) => {
    workerScope.postMessage({
      type: "stream",
      requestId: request.requestId,
      event: JSON.parse(eventJson),
    });
  });

  try {
    const result = await pyodide.runPythonAsync(`
import asyncio
import json

from pydantic_ai.models.test import TestModel

from engine.agent import build_chat_agent
from engine.document import DocumentNode
from engine.tools import DocumentContext

async def _run_stream_probe():
    root = DocumentNode.model_validate(json.loads(stream_probe_payload)["root"])
    context = DocumentContext(root=root, document_name=root.label)
    agent = build_chat_agent(
        TestModel(call_tools=[], custom_output_text="Probe streamed text.", model_name="phase-0-probe")
    )
    async with agent.run_stream("probe", deps=context) as response:
        async for delta in response.stream_text(delta=True, debounce_by=None):
            if delta:
                stream_probe_emit(json.dumps({"kind": "text", "delta": delta}))
                await asyncio.sleep(0.05)
        return await response.get_output()

await _run_stream_probe()
`);
    return String(result);
  } finally {
    pyodide.runPython("stream_probe_payload = None; stream_probe_emit = None");
  }
}

let requestChain = Promise.resolve();
workerScope.onmessage = (event) => {
  const request = event.data;
  requestChain = requestChain.then(async () => {
    try {
      const result = await execute(request);
      workerScope.postMessage({ type: "result", requestId: request.requestId, result });
    } catch (error) {
      const message = summarizeError(error);
      workerScope.postMessage({ type: "error", requestId: request.requestId, message });
    }
  });
};
