import type { DocumentNode } from "../parser";
import {
  parseCaseDigestAgentResult,
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

interface WorkerErrorMessage {
  type: "error";
  requestId?: number;
  message: string;
}

type WorkerResponse = WorkerStatusMessage | WorkerResultMessage | WorkerErrorMessage;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

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
  for (const pending of pendingRequests.values()) pending.reject(error);
  pendingRequests.clear();
}

function createWorker(): Worker {
  const nextWorker = new Worker(new URL("./engineWorker.ts", import.meta.url), { type: "module" });
  nextWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === "status") {
      setEngineStatus({ state: message.state, ...(message.message ? { message: message.message } : {}) });
      return;
    }

    const pending = message.requestId === undefined ? undefined : pendingRequests.get(message.requestId);
    if (!pending) return;
    pendingRequests.delete(message.requestId!);
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

function requestAgent(request: AgentRequest): Promise<unknown> {
  const activeWorker = worker ?? (worker = createWorker());
  const requestId = ++requestSequence;
  setEngineStatus({ state: "loading", message: "Preparing the on-device agent..." });

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    activeWorker.postMessage({
      requestId,
      ...request,
      modelId: request.credentials.modelId,
      apiKey: request.credentials.apiKey,
    });
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
