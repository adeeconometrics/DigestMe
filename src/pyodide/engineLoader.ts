import type { AssistantMessage } from "assistant-stream";
import type { DocumentNode } from "../parser";
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

interface WorkerResultMessage {
  type: "result";
  requestId: number;
  result: unknown;
}

interface WorkerStreamMessage {
  type: "stream";
  requestId: number;
  event: unknown;
}

interface WorkerErrorMessage {
  type: "error";
  requestId?: number;
  message: string;
}

type WorkerResponse = WorkerStatusMessage | WorkerStreamMessage | WorkerResultMessage | WorkerErrorMessage;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onStream?: (event: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** How long a single agent request may run before the worker is discarded. */
const REQUEST_TIMEOUT_MS = 120_000;

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

function createWorker(): Worker {
  const nextWorker = new Worker(new URL("./engineWorker.ts", import.meta.url), { type: "module" });
  nextWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === "status") {
      setEngineStatus({ state: message.state, ...(message.message ? { message: message.message } : {}) });
      return;
    }

    if (message.type === "stream") {
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

function requestAgent(request: AgentRequest, onStream?: (event: unknown) => void): Promise<unknown> {
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

    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("The agent request timed out."));
      activeWorker.terminate();
      if (worker === activeWorker) worker = null;
      rejectPending(new Error("The browser agent timed out and was stopped."));
      setEngineStatus({ state: "idle" });
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, reject, onStream, timer });
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
