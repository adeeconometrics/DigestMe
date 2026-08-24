import type { AssistantMessage } from "assistant-stream";
import type { DocumentNode } from "../parser";
import type { WireValue } from "../types";
import { createChatStreamAccumulator } from "../chat/agentStream";
import {
  parseCaseDigestAgentResult,
  parseChatStreamEvent,
  parseChatAgentResult,
  type AgentCredentials,
  type AgentRequest,
  type CaseDigestAgentResult,
  type ChatAgentResult,
  type EngineStatus,
} from "./types";

interface WorkerStatusMessage {
  type: "status";
  state: EngineStatus["state"];
  message?: string;
}

interface WorkerHeartbeatMessage {
  type: "heartbeat";
}

interface WorkerStartedMessage {
  type: "started";
  requestId: number;
}

interface WorkerResultMessage {
  type: "result";
  requestId: number;
  result: WireValue;
}

interface WorkerStreamMessage {
  type: "stream";
  requestId: number;
  event: WireValue;
}

interface WorkerErrorMessage {
  type: "error";
  requestId?: number;
  message: string;
}

type WorkerResponse =
  | WorkerStatusMessage
  | WorkerHeartbeatMessage
  | WorkerStartedMessage
  | WorkerStreamMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

interface PendingRequest {
  resolve: (value: WireValue) => void;
  reject: (reason: Error) => void;
  onStream?: (event: WireValue) => void;
  /** Whether the worker acknowledged execution; queued requests ride the boot watchdog instead. */
  started: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** Kill a request only after this much worker silence — not total runtime. */
const REQUEST_IDLE_TIMEOUT_MS = 120_000;

/**
 * Separate, generous budget for booting the runtime (pyodide download plus
 * micropip install of pydantic-ai) so cold starts are not charged against
 * the request's inactivity window.
 */
const ENGINE_LOAD_TIMEOUT_MS = 600_000;

let worker: Worker | null = null;
let requestSequence = 0;
let engineStatus: EngineStatus = { state: "idle" };
const pendingRequests = new Map<number, PendingRequest>();
const statusListeners = new Set<(status: EngineStatus) => void>();

function setEngineStatus(status: EngineStatus): void {
  engineStatus = status;
  for (const listener of statusListeners) listener(status);
}

function rejectPending(error: Error): void {
  const entries = [...pendingRequests.values()];
  pendingRequests.clear();
  for (const pending of entries) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
}

function currentWindowMs(pending: PendingRequest): number {
  return pending.started ? REQUEST_IDLE_TIMEOUT_MS : ENGINE_LOAD_TIMEOUT_MS;
}

function armRequestTimer(requestId: number, pending: PendingRequest): void {
  const windowMs = currentWindowMs(pending);
  clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    // Delete first so a late stream event cannot revive an expired request.
    pendingRequests.delete(requestId);
    const remainingRequests = pendingRequests.size;
    pending.reject(
      new Error(
        `The agent stopped responding (${Math.round(windowMs / 1000)}s without progress). Please try again.`,
      ),
    );
    if (remainingRequests === 0 && worker) {
      // Nothing left to protect and the runtime went silent: recycle it so
      // the next request gets a healthy runtime instead of a wedged queue.
      worker.terminate();
      worker = null;
      setEngineStatus({ state: "idle" });
    }
  }, windowMs);
}

/** Refresh every pending request's deadline after any sign of worker life. */
function refreshPendingTimers(): void {
  for (const [requestId, pending] of pendingRequests) armRequestTimer(requestId, pending);
}

function createWorker(): Worker {
  const nextWorker = new Worker(new URL("./engineWorker.ts", import.meta.url), { type: "module" });
  nextWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === "status") {
      if (message.state !== "idle") refreshPendingTimers();
      const status: EngineStatus = { state: message.state };
      if (message.message) status.message = message.message;
      setEngineStatus(status);
      return;
    }

    if (message.type === "heartbeat") {
      // Liveness proof from a busy runtime (e.g. a silent non-streaming run).
      refreshPendingTimers();
      return;
    }

    if (message.type === "started") {
      const pending = pendingRequests.get(message.requestId);
      if (!pending) return;
      pending.started = true;
      armRequestTimer(message.requestId, pending);
      return;
    }

    if (message.type === "stream") {
      refreshPendingTimers();
      const pending = pendingRequests.get(message.requestId);
      if (!pending?.onStream) return;
      try {
        pending.onStream(message.event);
      } catch (error) {
        pendingRequests.delete(message.requestId);
        clearTimeout(pending.timer);
        pending.reject(error instanceof Error ? error : new Error("The agent stream was invalid."));
      }
      return;
    }

    const pending = message.requestId === undefined ? undefined : pendingRequests.get(message.requestId);
    if (!pending) return;
    pendingRequests.delete(message.requestId!);
    clearTimeout(pending.timer);
    if (message.type === "error") pending.reject(new Error(message.message));
    else pending.resolve(message.result);
  };
  nextWorker.onerror = (event) => {
    const error = new Error(event.message || "The browser agent worker stopped unexpectedly.");
    setEngineStatus({ state: "failed", message: error.message });
    rejectPending(error);
    nextWorker.terminate();
    if (worker === nextWorker) worker = null;
  };
  return nextWorker;
}

function requestAgent(request: AgentRequest, onStream?: (event: WireValue) => void): Promise<WireValue> {
  const activeWorker = worker ?? (worker = createWorker());
  const requestId = ++requestSequence;
  setEngineStatus({ state: "loading", message: "Preparing the on-device agent..." });

  return new Promise((resolve, reject) => {
    const { credentials, ...command } = request;
    try {
      activeWorker.postMessage({
        requestId,
        ...command,
        stream: Boolean(onStream),
        modelId: credentials.modelId,
        apiKey: credentials.apiKey,
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("The browser agent could not accept the request."));
      return;
    }

    const pending: PendingRequest = { resolve, reject, onStream, started: false };
    pendingRequests.set(requestId, pending);
    armRequestTimer(requestId, pending);
  });
}

export function subscribeEngineStatus(listener: (status: EngineStatus) => void): () => void {
  statusListeners.add(listener);
  listener(engineStatus);
  return () => statusListeners.delete(listener);
}

export function getEngineStatus(): EngineStatus {
  return engineStatus;
}

export async function runChatAgent(
  root: DocumentNode,
  question: string,
  credentials: AgentCredentials,
): Promise<ChatAgentResult> {
  return parseChatAgentResult(await requestAgent({ command: "chat", root, question, credentials }));
}

export async function streamChatAgent(
  root: DocumentNode,
  question: string,
  credentials: AgentCredentials,
  onUpdate: (message: AssistantMessage) => void,
): Promise<ChatAgentResult> {
  const stream = createChatStreamAccumulator(onUpdate);
  try {
    const result = parseChatAgentResult(
      await requestAgent(
        { command: "chat", root, question, credentials },
        (event) => stream.push(parseChatStreamEvent(event)),
      ),
    );
    await stream.finish();
    return result;
  } catch (error) {
    await stream.abort();
    throw error;
  }
}

export async function runCaseDigestAgent(
  root: DocumentNode,
  credentials: AgentCredentials,
): Promise<CaseDigestAgentResult> {
  return parseCaseDigestAgentResult(await requestAgent({ command: "digest", root, credentials }));
}

export function disposeEngine(): void {
  worker?.terminate();
  worker = null;
  rejectPending(new Error("The browser agent was stopped."));
  setEngineStatus({ state: "idle" });
}
