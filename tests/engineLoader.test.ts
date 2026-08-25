import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantText } from "../src/chat/agentStream";
import { cancelAgentRequest, disposeEngine, getEngineStatus, runChatAgent, streamChatAgent } from "../src/pyodide/engineLoader";
import type { DocumentNode } from "../src/parser";

/**
 * Minimal stand-in for the Pyodide engine worker. Tests drive the loader by
 * emitting the worker protocol messages (status/started/stream/heartbeat/
 * result/error) and observe how the request timers react.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: { data: any }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;
  readonly sent: any[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(data: any): void {
    this.sent.push(data);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: any): void {
    this.onmessage?.({ data: message });
  }
}

const CREDENTIALS = { modelId: "openai/gpt-4o-mini", apiKey: "sk-or-v1-test-key" };
const ROOT: DocumentNode = {
  id: "doc-root",
  kind: "document",
  label: "Mock v. Mock",
  section: "",
  page: null,
  children: [],
};
const CHAT_RESULT = {
  model: "openai/gpt-4o-mini",
  elapsed_ms: 1_000,
  markdown: "# Held: affirmed",
  references: [],
};

function lastWorker(): FakeWorker {
  return FakeWorker.instances[FakeWorker.instances.length - 1];
}

/** The loader echoes the requestId back on every postMessage; index counts back from the latest. */
function postedRequestId(worker: FakeWorker, offsetFromEnd = 0): number {
  // SAFETY: the loader only posts request messages, and every request carries a numeric requestId.
  const message = worker.sent[worker.sent.length - 1 - offsetFromEnd] as { requestId: number };
  return message.requestId;
}

async function bootEngine(worker: FakeWorker): Promise<void> {
  worker.emit({ type: "status", state: "loading", message: "Loading the Python runtime..." });
  worker.emit({ type: "status", state: "ready" });
}

function emitTextDelta(worker: FakeWorker, requestId: number): void {
  worker.emit({
    type: "stream",
    requestId,
    event: { type: "part-start", index: 0, kind: "text", content: "..." },
  });
}

/** Attach a rejection handler synchronously so fake-timer expiries are not "unhandled". */
function captureRejection<T>(promise: Promise<T>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("Expected the request to be rejected.");
    },
    (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
  );
}

describe("engineLoader request timers", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    vi.useFakeTimers();
  });

  afterEach(() => {
    disposeEngine();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps a streaming agent alive well beyond the legacy two-minute cap", async () => {
    const run = streamChatAgent(ROOT, "Summarize the holding.", CREDENTIALS, () => undefined);
    const worker = lastWorker();
    await bootEngine(worker);
    worker.emit({ type: "started", requestId: postedRequestId(worker) });

    // Stream steadily for seven minutes; the legacy fixed 120s budget would
    // have terminated the worker mid-run.
    for (let minute = 0; minute < 7; minute++) {
      emitTextDelta(worker, postedRequestId(worker));
      await vi.advanceTimersByTimeAsync(60_000);
    }

    worker.emit({ type: "result", requestId: postedRequestId(worker), result: CHAT_RESULT });
    await expect(run).resolves.toMatchObject({ markdown: "# Held: affirmed" });
    expect(worker.terminated).toBe(false);
  });

  it("routes interleaved stream events to their distinct request callbacks", async () => {
    const firstUpdates: string[] = [];
    const secondUpdates: string[] = [];
    const first = streamChatAgent(ROOT, "first", CREDENTIALS, (message) => firstUpdates.push(assistantText(message)));
    const worker = lastWorker();
    const firstId = postedRequestId(worker);
    const second = streamChatAgent(ROOT, "second", CREDENTIALS, (message) => secondUpdates.push(assistantText(message)));
    const secondId = postedRequestId(worker);
    await bootEngine(worker);
    worker.emit({ type: "started", requestId: firstId });
    worker.emit({ type: "started", requestId: secondId });

    worker.emit({ type: "stream", requestId: firstId, event: { type: "part-start", index: 0, kind: "text", content: "first" } });
    worker.emit({ type: "stream", requestId: secondId, event: { type: "part-start", index: 0, kind: "text", content: "second" } });
    worker.emit({ type: "result", requestId: firstId, result: CHAT_RESULT });
    worker.emit({ type: "result", requestId: secondId, result: CHAT_RESULT });

    await expect(first).resolves.toMatchObject({ markdown: "# Held: affirmed" });
    await expect(second).resolves.toMatchObject({ markdown: "# Held: affirmed" });
    expect(firstUpdates.at(-1)).toBe("first");
    expect(secondUpdates.at(-1)).toBe("second");
  });

  it("reports queued work before the worker acknowledges execution", async () => {
    const states: string[] = [];
    const run = runChatAgent(ROOT, "show request state", CREDENTIALS, {
      onRequestState: (state) => states.push(state),
    });
    const worker = lastWorker();
    const requestId = postedRequestId(worker);

    expect(states).toEqual(["queued"]);
    await bootEngine(worker);
    expect(states).toEqual(["queued"]);

    worker.emit({ type: "started", requestId });
    expect(states).toEqual(["queued", "running"]);
    worker.emit({ type: "result", requestId, result: CHAT_RESULT });

    await expect(run).resolves.toMatchObject({ markdown: "# Held: affirmed" });
  });

  it("keeps a second request queued until its worker slot opens", async () => {
    const firstStates: string[] = [];
    const secondStates: string[] = [];
    const first = runChatAgent(ROOT, "first queued state", CREDENTIALS, {
      onRequestState: (state) => firstStates.push(state),
    });
    const worker = lastWorker();
    const firstId = postedRequestId(worker);
    const second = runChatAgent(ROOT, "second queued state", CREDENTIALS, {
      onRequestState: (state) => secondStates.push(state),
    });
    const secondId = postedRequestId(worker);

    expect(firstStates).toEqual(["queued"]);
    expect(secondStates).toEqual(["queued"]);
    await bootEngine(worker);
    worker.emit({ type: "started", requestId: firstId });
    expect(firstStates).toEqual(["queued", "running"]);
    expect(secondStates).toEqual(["queued"]);

    worker.emit({ type: "result", requestId: firstId, result: CHAT_RESULT });
    worker.emit({ type: "started", requestId: secondId });
    expect(secondStates).toEqual(["queued", "running"]);
    worker.emit({ type: "result", requestId: secondId, result: CHAT_RESULT });

    await expect(first).resolves.toMatchObject({ markdown: "# Held: affirmed" });
    await expect(second).resolves.toMatchObject({ markdown: "# Held: affirmed" });
  });

  it("cancels one request promptly without terminating the shared worker", async () => {
    let requestId = 0;
    const run = runChatAgent(ROOT, "cancel me", CREDENTIALS, { onRequestId: (id) => { requestId = id; } });
    const worker = lastWorker();
    await bootEngine(worker);
    worker.emit({ type: "started", requestId: postedRequestId(worker) });
    const failure = captureRejection(run);

    cancelAgentRequest(requestId);

    await expect(failure).resolves.toBeInstanceOf(Error);
    await expect(run).rejects.toThrow("cancelled");
    expect(worker.sent.at(-1)).toEqual({ command: "cancel", requestId });
    expect(worker.terminated).toBe(false);
    worker.emit({ type: "result", requestId, result: CHAT_RESULT });
  });

  it("keeps the remaining request timer after cancelling its sibling", async () => {
    let firstId = 0;
    const first = runChatAgent(ROOT, "cancel first", CREDENTIALS, { onRequestId: (id) => { firstId = id; } });
    const second = runChatAgent(ROOT, "keep second", CREDENTIALS);
    const worker = lastWorker();
    const secondId = postedRequestId(worker);
    await bootEngine(worker);
    worker.emit({ type: "started", requestId: firstId });
    worker.emit({ type: "started", requestId: secondId });
    const firstFailure = captureRejection(first);

    cancelAgentRequest(firstId);
    await expect(firstFailure).resolves.toBeInstanceOf(Error);
    worker.emit({ type: "result", requestId: secondId, result: CHAT_RESULT });

    await expect(second).resolves.toMatchObject({ markdown: "# Held: affirmed" });
    expect(worker.terminated).toBe(false);
  });

  it("keeps a third request pending until the worker grants a scheduler slot", async () => {
    const first = runChatAgent(ROOT, "first", CREDENTIALS);
    const second = runChatAgent(ROOT, "second", CREDENTIALS);
    const third = runChatAgent(ROOT, "third", CREDENTIALS);
    const worker = lastWorker();
    const firstId = postedRequestId(worker, 2);
    const secondId = postedRequestId(worker, 1);
    const thirdId = postedRequestId(worker);
    await bootEngine(worker);
    worker.emit({ type: "started", requestId: firstId });
    worker.emit({ type: "started", requestId: secondId });

    worker.emit({ type: "result", requestId: firstId, result: CHAT_RESULT });
    worker.emit({ type: "started", requestId: thirdId });
    worker.emit({ type: "result", requestId: secondId, result: CHAT_RESULT });
    worker.emit({ type: "result", requestId: thirdId, result: CHAT_RESULT });

    await expect(first).resolves.toMatchObject({ markdown: "# Held: affirmed" });
    await expect(second).resolves.toMatchObject({ markdown: "# Held: affirmed" });
    await expect(third).resolves.toMatchObject({ markdown: "# Held: affirmed" });
  });

  it("expires only the silent request while a queued one stays pending", async () => {
    const silent = runChatAgent(ROOT, "first", CREDENTIALS);
    const queued = runChatAgent(ROOT, "second", CREDENTIALS);
    const worker = lastWorker();
    const silentId = postedRequestId(worker, 1);
    const queuedId = postedRequestId(worker);
    await bootEngine(worker);
    worker.emit({ type: "started", requestId: silentId });

    const silentFailure = captureRejection(silent);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await silentFailure).toBeInstanceOf(Error);
    await expect(silent).rejects.toThrow(/stopped responding/);

    // The queued request keeps the worker alive, so no recycle happens.
    expect(worker.terminated).toBe(false);
    expect(getEngineStatus().state).not.toBe("idle");

    worker.emit({ type: "started", requestId: queuedId });
    worker.emit({ type: "result", requestId: queuedId, result: CHAT_RESULT });
    await expect(queued).resolves.toMatchObject({ markdown: "# Held: affirmed" });
  });

  it("recycles a fully silent worker so the next run gets a fresh runtime", async () => {
    const doomed = runChatAgent(ROOT, "only", CREDENTIALS);
    const worker = lastWorker();
    await bootEngine(worker);
    worker.emit({ type: "started", requestId: postedRequestId(worker) });

    const doomedFailure = captureRejection(doomed);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await doomedFailure).toBeInstanceOf(Error);
    await expect(doomed).rejects.toThrow(/stopped responding/);
    expect(worker.terminated).toBe(true);
    expect(getEngineStatus().state).toBe("idle");

    const next = runChatAgent(ROOT, "again", CREDENTIALS);
    const fresh = lastWorker();
    expect(fresh).not.toBe(worker);
    fresh.emit({ type: "error", requestId: postedRequestId(fresh), message: "engine exploded" });
    await expect(next).rejects.toThrow("engine exploded");
  });

  it("lets a queued request outlive the long-running request ahead of it", async () => {
    const ahead = runChatAgent(ROOT, "long-running", CREDENTIALS);
    const worker = lastWorker();
    await bootEngine(worker);
    const aheadId = postedRequestId(worker);
    worker.emit({ type: "started", requestId: aheadId });

    const queued = runChatAgent(ROOT, "queued", CREDENTIALS);
    const queuedId = postedRequestId(worker);

    // Five minutes of streaming from the ahead request; the queued request
    // waits silently the whole time. The legacy per-request timer killed it
    // at two minutes and took the running request down with it.
    for (let minute = 0; minute < 5; minute++) {
      emitTextDelta(worker, aheadId);
      await vi.advanceTimersByTimeAsync(60_000);
    }

    worker.emit({ type: "result", requestId: aheadId, result: CHAT_RESULT });
    await expect(ahead).resolves.toMatchObject({ markdown: "# Held: affirmed" });

    worker.emit({ type: "result", requestId: queuedId, result: CHAT_RESULT });
    await expect(queued).resolves.toMatchObject({ markdown: "# Held: affirmed" });
    expect(worker.terminated).toBe(false);
  });

  it("gives engine boot its own generous budget separate from the idle window", async () => {
    const run = runChatAgent(ROOT, "cold start", CREDENTIALS);
    const worker = lastWorker();

    // A slow pyodide download plus micropip install: ~11 minutes total, far
    // past the legacy fixed cap, refreshed by progress status messages.
    worker.emit({ type: "status", state: "loading", message: "Loading the Python runtime..." });
    await vi.advanceTimersByTimeAsync(590_000);
    worker.emit({ type: "status", state: "loading", message: "Installing the case-digest agent..." });
    await vi.advanceTimersByTimeAsync(59_000);
    worker.emit({ type: "status", state: "ready" });
    worker.emit({ type: "started", requestId: postedRequestId(worker) });

    await vi.advanceTimersByTimeAsync(60_000);
    worker.emit({ type: "result", requestId: postedRequestId(worker), result: CHAT_RESULT });
    await expect(run).resolves.toMatchObject({ markdown: "# Held: affirmed" });
  });

  it("survives on worker heartbeats during a silent non-streaming run", async () => {
    const run = runChatAgent(ROOT, "quiet digest", CREDENTIALS);
    const worker = lastWorker();
    await bootEngine(worker);
    const requestId = postedRequestId(worker);
    worker.emit({ type: "started", requestId });

    // Ten heartbeats over five minutes prove the runtime is busy even though
    // the structured-output run emits no stream events.
    for (let beat = 0; beat < 10; beat++) {
      worker.emit({ type: "heartbeat" });
      await vi.advanceTimersByTimeAsync(30_000);
    }

    worker.emit({ type: "result", requestId, result: CHAT_RESULT });
    await expect(run).resolves.toMatchObject({ markdown: "# Held: affirmed" });
    expect(worker.terminated).toBe(false);
  });
});
