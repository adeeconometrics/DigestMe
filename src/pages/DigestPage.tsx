import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import type { AssistantMessage } from "assistant-stream";
import DOMPurify from "dompurify";
import { marked } from "marked";
import Icon from "../components/Icon";
import DigestGraph from "../components/DigestGraph";
import { getChatThreadForDocument, getDigestSession, getDocumentWithSource, putChatThread, putDigestSession, removeDocument } from "../lib/db";
import type { StoredDocumentFile, StoredDigestFile } from "../lib/db";
import { caseDigestFileName, renderCaseDigestDocx } from "../lib/caseDigestDocx";
import { caseDigestToMarkdown } from "../lib/caseDigestMarkdown";
import { getAgentRuntimeCredentials } from "../lib/agentSettings";
import { flattenTree, isPdfFile, parsePdf } from "../parser";
import type { DocumentNode, ParsedDocument } from "../parser";
import { assistantText, assistantThinking, createInitialAssistantMessage } from "../chat/agentStream";
import { referencesForAnswer, executionDescription, formatExecutionTime, formatExecutionTimestamp, mapAgentReferences } from "../chat/agentChat";
import { retrieveNodes } from "../chat/retrieval";
import type { RetrievalHit } from "../chat/retrieval";
import {
  serializeChatMessage,
  type ChatMessage,
  type ChatThread,
  type DigestSession,
  type PersistedChatMessage,
} from "../chat/session";
import { cancelAgentRequest, disposeEngine, runCaseDigestAgent, streamChatAgent, type AgentRequestState } from "../pyodide/engineLoader";
import type { AgentExecution } from "../pyodide/types";
import type { DocumentSummary } from "../types";

const PdfReferenceViewer = lazy(() => import("../components/PdfReferenceViewer"));
const DocxPreviewModal = lazy(() => import("../components/DocxPreviewModal"));

type DigestStatus = "idle" | "parsing" | "error";
type AgentStatus = "idle" | "queued" | "running" | "complete" | "failed";

function makeMessageId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `msg-${randomId ?? Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function makeSessionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `digest-${randomId ?? Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function welcomeMessage(): Extract<ChatMessage, { kind: "welcome" }> {
  return { id: makeMessageId(), at: new Date().toISOString(), role: "assistant", kind: "welcome" };
}

interface DigestPreview {
  blob: Blob;
  fileName: string;
  downloadUrl: string;
}

interface DigestPageProps {
  documentId: string | null;
  autoRunDigest?: boolean;
  queuePosition?: number;
  pendingFile?: File | null;
  onDocumentReady?: (summary: DocumentSummary) => void;
  onStatusChange?: (status: AgentStatus) => void;
  onStorageError?: (message: string) => void;
}

interface ThreadSnapshot {
  isReady: boolean;
  messages: ChatMessage[];
  selected: ParsedDocument | null;
  selectedFile: StoredDocumentFile | null;
  sessionCreatedAt: string;
  sessionDocumentId: string | null;
  sessionId: string;
}

/** Case digest: a chat session over a locally parsed PDF. */
export default function DigestPage({
  documentId,
  autoRunDigest,
  queuePosition,
  pendingFile,
  onDocumentReady,
  onStatusChange,
  onStorageError,
}: DigestPageProps) {
  const [selected, setSelected] = useState<ParsedDocument | null>(null);
  const [selectedFile, setSelectedFile] = useState<StoredDocumentFile | null>(null);
  const [sessionId, setSessionId] = useState(() => makeSessionId());
  const [sessionCreatedAt, setSessionCreatedAt] = useState(() => new Date().toISOString());
  const [sessionDocumentId, setSessionDocumentId] = useState<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(() => documentId === null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; nonce: number } | null>(null);
  const [traceRequest, setTraceRequest] = useState<{ nodeIds: string[]; nonce: number } | null>(null);
  const [status, setStatus] = useState<DigestStatus>("idle");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>(() => queuePosition === undefined ? "idle" : "queued");
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage()]);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<DigestPreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const agentRequestRef = useRef(0);
  const activeAgentRequestIdRef = useRef<number | null>(null);
  const activeStreamMessageRef = useRef<string | null>(null);
  const docxUrlsRef = useRef<Set<string>>(new Set());
  const digestFilesRef = useRef<Map<string, StoredDigestFile>>(new Map());
  const persistenceQueueRef = useRef(Promise.resolve());
  const lastPersistedFingerprintRef = useRef("");
  const messagesRef = useRef(messages);
  const selectedRef = useRef(selected);
  const selectedFileRef = useRef(selectedFile);
  const sessionIdRef = useRef(sessionId);
  const sessionCreatedAtRef = useRef(sessionCreatedAt);
  const sessionDocumentIdRef = useRef(sessionDocumentId);
  const isSessionReadyRef = useRef(isSessionReady);
  const onStatusChangeRef = useRef(onStatusChange);
  const pendingFileConsumedRef = useRef(false);
  const autoRunConsumedRef = useRef(false);
  const digestReadyRef = useRef(false);

  const selectedNode: DocumentNode | null = useMemo(() => {
    if (!selected || !selectedNodeId) return null;
    return flattenTree(selected.root).find((node) => node.id === selectedNodeId) ?? null;
  }, [selected, selectedNodeId]);

  const pushMessage = useCallback((message: ChatMessage): void => {
    setMessages((previous) => [...previous, message]);
  }, []);

  /**
   * Switch the graph into path-tracer mode for a response's references:
   * trace every cited section's root→node path and recenter on it.
   */
  const triggerPathTrace = useCallback((refs: RetrievalHit[]): void => {
    if (!refs.length) return;
    setSelectedNodeId(null);
    setTraceRequest({ nodeIds: refs.map((ref) => ref.nodeId), nonce: Date.now() });
  }, []);

  const clearDocxAssets = useCallback((): void => {
    for (const url of docxUrlsRef.current) URL.revokeObjectURL(url);
    docxUrlsRef.current.clear();
    digestFilesRef.current.clear();
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    selectedRef.current = selected;
    selectedFileRef.current = selectedFile;
    sessionIdRef.current = sessionId;
    sessionCreatedAtRef.current = sessionCreatedAt;
    sessionDocumentIdRef.current = sessionDocumentId;
    isSessionReadyRef.current = isSessionReady;
  }, [isSessionReady, messages, selected, selectedFile, sessionCreatedAt, sessionDocumentId, sessionId]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  // Parse a file handed to this tab from a sidebar drop before any interaction.
  useEffect(() => {
    if (!pendingFile || pendingFileConsumedRef.current) return;
    pendingFileConsumedRef.current = true;
    queueMicrotask(() => void processPdf(pendingFile));
  }, [pendingFile]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  const pushError = useCallback((text: string): void => {
    pushMessage({ id: makeMessageId(), at: new Date().toISOString(), role: "assistant", kind: "error", text });
  }, [pushMessage]);

  /** Connect to the agent and compose the structured case digest for a parsed document. */
  const runCaseDigest = useCallback(async (selectedDocument: ParsedDocument): Promise<void> => {
    const requestId = ++agentRequestRef.current;
    setAgentStatus("queued");
    const credentials = await getAgentRuntimeCredentials().catch(() => null);
    if (requestId !== agentRequestRef.current) return;
    if (!credentials) {
      pushError("Save an OpenRouter model and API key in Settings before running /digest.");
      setAgentStatus("failed");
      return;
    }

    const requestOptions = {
      onRequestId: (loaderRequestId: number) => {
        if (requestId === agentRequestRef.current) {
          activeAgentRequestIdRef.current = loaderRequestId;
        } else {
          cancelAgentRequest(loaderRequestId);
        }
      },
      onRequestState: (nextState: AgentRequestState) => {
        if (requestId === agentRequestRef.current) setAgentStatus(nextState);
      },
    };

    let completed = false;
    try {
      const result = await runCaseDigestAgent(selectedDocument.root, credentials, requestOptions);
      if (requestId !== agentRequestRef.current) return;

      const markdown = caseDigestToMarkdown(result.digest);
      const docxBlob = await renderCaseDigestDocx(result.digest);
      if (requestId !== agentRequestRef.current) return;
      const docxUrl = URL.createObjectURL(docxBlob);
      const messageId = makeMessageId();
      const docxFileId = `${sessionIdRef.current}-${messageId}`;
      const docxFileName = caseDigestFileName(result.digest.case_title);
      docxUrlsRef.current.add(docxUrl);
      digestFilesRef.current.set(docxFileId, {
        id: docxFileId,
        sessionId: sessionIdRef.current,
        fileName: docxFileName,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        blob: docxBlob,
      });
      pushMessage({
        id: messageId,
        at: new Date().toISOString(),
        role: "assistant",
        kind: "digest",
        markdown,
        digest: result.digest,
        refs: mapAgentReferences(selectedDocument.root, result.references),
        execution: { model: result.model, elapsedMs: result.elapsedMs },
        docxUrl,
        docxFileName,
        docxFileId,
        docxBlob,
      });
      digestReadyRef.current = true;
      completed = true;
    } catch (error) {
      if (requestId === agentRequestRef.current) {
        pushError(error instanceof Error ? error.message : "The case digest agent could not complete that request.");
        setAgentStatus("failed");
      }
    } finally {
      if (requestId === agentRequestRef.current) {
        activeAgentRequestIdRef.current = null;
        if (completed) setAgentStatus("complete");
      }
    }
  }, [pushError, pushMessage]);

  const stopAgent = useCallback((removeStreamMessage: boolean): void => {
    agentRequestRef.current += 1;
    const requestId = activeAgentRequestIdRef.current;
    activeAgentRequestIdRef.current = null;
    if (requestId !== null) cancelAgentRequest(requestId);
    const streamMessageId = activeStreamMessageRef.current;
    activeStreamMessageRef.current = null;
    if (removeStreamMessage && streamMessageId) {
      setMessages((previous) => previous.filter((message) => message.id !== streamMessageId));
    }
    if (removeStreamMessage) {
      setAgentStatus(digestReadyRef.current ? "complete" : "idle");
    }
  }, []);

  const queuePersistSnapshot = useCallback((snapshot: ThreadSnapshot): void => {
    if (!snapshot.isReady) return;
    const targetDocumentId = snapshot.selected?.id ?? snapshot.sessionDocumentId;
    if (!targetDocumentId) return;
    const title = snapshot.selected?.fileName ?? "New digest session";
    const messagesToPersist = snapshot.messages
      .map(serializeChatMessage)
      .filter((message): message is PersistedChatMessage => message !== null);
    const digestFiles = Array.from(digestFilesRef.current.values());
    const fingerprint = JSON.stringify({
      createdAt: snapshot.sessionCreatedAt,
      digestFiles: digestFiles.map((file) => ({ id: file.id, fileName: file.fileName })),
      documentId: targetDocumentId,
      messages: messagesToPersist,
      sessionId: snapshot.sessionId,
      title,
    });
    if (fingerprint === lastPersistedFingerprintRef.current) return;
    lastPersistedFingerprintRef.current = fingerprint;

    const updatedAt = new Date().toISOString();
    const thread: ChatThread = {
      threadId: snapshot.sessionId,
      documentId: targetDocumentId,
      messages: messagesToPersist,
      createdAt: snapshot.sessionCreatedAt,
      updatedAt,
    };
    const session: DigestSession = {
      id: snapshot.sessionId,
      title,
      documentId: targetDocumentId,
      createdAt: snapshot.sessionCreatedAt,
      updatedAt,
      messages: messagesToPersist,
    };
    const source = snapshot.selected && snapshot.selectedFile ? { document: snapshot.selected, file: snapshot.selectedFile } : undefined;
    persistenceQueueRef.current = persistenceQueueRef.current
      .catch(() => undefined)
      .then(() => putChatThread(thread))
      .then(() => putDigestSession(session, source, digestFiles))
      .catch(() => {
        lastPersistedFingerprintRef.current = "";
        onStorageError?.("IndexedDB could not save this chat thread.");
      });
  }, [onStorageError]);

  useEffect(() => {
    onStatusChangeRef.current?.(agentStatus);
  }, [agentStatus]);

  useEffect(() => {
    if (documentId === null) return undefined;
    let mounted = true;
    setIsSessionReady(false);
    void (async () => {
      try {
        const source = await getDocumentWithSource(documentId);
        if (!source) throw new Error("That document could not be loaded from local storage.");
        const thread = await getChatThreadForDocument(documentId);
        const storedSession = thread ? await getDigestSession(thread.threadId) : undefined;
        if (!mounted) return;

        clearDocxAssets();
        const assets = new Map(storedSession?.digestFiles.map((file) => [file.id, file]) ?? []);
        digestFilesRef.current = assets;
        const restoredMessages: ChatMessage[] = (thread?.messages ?? storedSession?.session.messages ?? [welcomeMessage()]).map((message) => {
          if (message.kind !== "digest") return message;
          const asset = assets.get(message.docxFileId);
          if (!asset) return message;
          const docxUrl = URL.createObjectURL(asset.blob);
          docxUrlsRef.current.add(docxUrl);
          return { ...message, docxBlob: asset.blob, docxUrl };
        });
        const digestReady = restoredMessages.some((message) => message.kind === "digest");
        const restoredSessionId = thread?.threadId ?? storedSession?.session.id ?? makeSessionId();
        setSessionId(restoredSessionId);
        sessionIdRef.current = restoredSessionId;
        setSessionCreatedAt(thread?.createdAt ?? storedSession?.session.createdAt ?? new Date().toISOString());
        setSessionDocumentId(documentId);
        setIsSessionReady(true);
        setSelected(source.document);
        setSelectedFile(source.file);
        setSelectedNodeId(null);
        setFocusRequest(null);
        setTraceRequest(null);
        setStatus("idle");
        setDraft("");
        setPreview(null);
        setMessages(restoredMessages);
        digestReadyRef.current = digestReady;
        setAgentStatus(digestReady ? "complete" : queuePosition === undefined ? "idle" : "queued");
        lastPersistedFingerprintRef.current = "";
        if (autoRunDigest && !digestReady && !autoRunConsumedRef.current) {
          autoRunConsumedRef.current = true;
          pushMessage({ id: makeMessageId(), at: new Date().toISOString(), role: "user", kind: "question", text: "/digest" });
          void runCaseDigest(source.document);
        }
      } catch (error) {
        if (!mounted) return;
        setStatus("error");
        if (queuePosition !== undefined) setAgentStatus("failed");
        pushError(error instanceof Error ? error.message : "That document could not be loaded from local storage.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [autoRunDigest, clearDocxAssets, documentId, pushError, pushMessage, queuePosition, runCaseDigest]);

  useEffect(() => {
    if (!isSessionReady) return;
    queuePersistSnapshot({ isReady: isSessionReady, messages, selected, selectedFile, sessionCreatedAt, sessionDocumentId, sessionId });
  }, [isSessionReady, messages, queuePersistSnapshot, selected, selectedFile, sessionCreatedAt, sessionDocumentId, sessionId]);

  useEffect(
    () => () => {
      queuePersistSnapshot({
        isReady: isSessionReadyRef.current,
        messages: messagesRef.current,
        selected: selectedRef.current,
        selectedFile: selectedFileRef.current,
        sessionCreatedAt: sessionCreatedAtRef.current,
        sessionDocumentId: sessionDocumentIdRef.current,
        sessionId: sessionIdRef.current,
      });
      stopAgent(false);
      onStatusChangeRef.current?.("idle");
      clearDocxAssets();
    },
    [clearDocxAssets, queuePersistSnapshot, stopAgent],
  );

  async function processPdf(file: File): Promise<void> {
    if (!isPdfFile(file)) {
      pushError("That file is not a PDF — choose one ending in .pdf.");
      return;
    }

    digestReadyRef.current = false;
    setAgentStatus(queuePosition === undefined ? "idle" : "queued");
    const requestId = ++agentRequestRef.current;
    setStatus("parsing");
    try {
      const parsed = await parsePdf(file);
      if (requestId !== agentRequestRef.current) return;
      const stored: StoredDocumentFile = { id: parsed.id, fileName: file.name, mimeType: file.type || "application/pdf", blob: file };
      const at = new Date().toISOString();
      const additions: ChatMessage[] = [
        { id: makeMessageId(), at, role: "user", kind: "attachment", fileName: parsed.fileName },
        {
          id: makeMessageId(),
          at,
          role: "assistant",
          kind: "parse-summary",
          fileName: parsed.fileName,
          pageCount: parsed.metrics.pageCount,
          nodeCount: flattenTree(parsed.root).length,
          ms: parsed.metrics.processingTimeMs,
          pdfType: parsed.metrics.pdfType,
        },
      ];
      const persistedMessages = messagesRef.current
        .concat(additions)
        .map(serializeChatMessage)
        .filter((message): message is PersistedChatMessage => message !== null);
      const session: DigestSession = {
        id: sessionIdRef.current,
        title: parsed.fileName,
        documentId: parsed.id,
        createdAt: sessionCreatedAtRef.current,
        updatedAt: at,
        messages: persistedMessages,
      };
      const thread: ChatThread = {
        threadId: session.id,
        documentId: parsed.id,
        messages: persistedMessages,
        createdAt: session.createdAt,
        updatedAt: at,
      };
      if (sessionDocumentIdRef.current && sessionDocumentIdRef.current !== parsed.id) await removeDocument(sessionDocumentIdRef.current);
      await putChatThread(thread);
      await putDigestSession(session, { document: parsed, file: stored }, Array.from(digestFilesRef.current.values()));
      setSelected(parsed);
      setSelectedFile(stored);
      setSessionDocumentId(parsed.id);
      setSelectedNodeId(null);
      setFocusRequest(null);
      setTraceRequest(null);
      setStatus("idle");
      setIsSessionReady(true);
      setMessages([...messagesRef.current.filter((message) => message.kind !== "agent-stream"), ...additions]);
      lastPersistedFingerprintRef.current = "";
      onDocumentReady?.({
        id: parsed.id,
        fileName: parsed.fileName,
        parsedAt: parsed.parsedAt,
        pageCount: parsed.metrics.pageCount,
        pdfType: parsed.metrics.pdfType,
        nodeCount: flattenTree(parsed.root).length,
      });
    } catch (error) {
      setStatus("error");
      if (queuePosition !== undefined) setAgentStatus("failed");
      pushError(error instanceof Error ? error.message : "This PDF could not be parsed.");
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) void processPdf(file);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void processPdf(file);
  }

  function isDigestCommand(question: string): boolean {
    return question.trim().toLowerCase() === "/digest";
  }

  async function submitQuestion(rawQuestion: string): Promise<void> {
    if (status === "parsing" || agentStatus === "queued" || agentStatus === "running") return;
    const question = rawQuestion.trim();
    if (!question) return;
    const requestId = ++agentRequestRef.current;
    const selectedDocument = selected;

    setDraft("");
    setTraceRequest(null);
    pushMessage({ id: makeMessageId(), at: new Date().toISOString(), role: "user", kind: "question", text: question });

    if (!selectedDocument) {
      pushMessage({ id: makeMessageId(), at: new Date().toISOString(), role: "assistant", kind: "nudge" });
      return;
    }

    if (isDigestCommand(question)) {
      await runCaseDigest(selectedDocument);
      return;
    }

    const credentials = await getAgentRuntimeCredentials().catch(() => null);
    if (requestId !== agentRequestRef.current) return;

    const requestOptions = {
      onRequestId: (loaderRequestId: number) => {
        if (requestId === agentRequestRef.current) {
          activeAgentRequestIdRef.current = loaderRequestId;
        } else {
          cancelAgentRequest(loaderRequestId);
        }
      },
      onRequestState: (nextState: AgentRequestState) => {
        if (requestId === agentRequestRef.current) setAgentStatus(nextState);
      },
    };

    if (isDigestCommand(question)) {
      if (!credentials) {
        pushError("Save an OpenRouter model and API key in Settings before running /digest.");
        return;
      }

      setAgentStatus("running");
      let completed = false;
      try {
        const result = await runCaseDigestAgent(selectedDocument.root, credentials, requestOptions);
        if (requestId !== agentRequestRef.current) return;

        const markdown = caseDigestToMarkdown(result.digest);
        const docxBlob = await renderCaseDigestDocx(result.digest);
        if (requestId !== agentRequestRef.current) return;
        const docxUrl = URL.createObjectURL(docxBlob);
        const messageId = makeMessageId();
        const docxFileId = `${sessionIdRef.current}-${messageId}`;
        const docxFileName = caseDigestFileName(result.digest.case_title);
        docxUrlsRef.current.add(docxUrl);
        digestFilesRef.current.set(docxFileId, {
          id: docxFileId,
          sessionId,
          fileName: docxFileName,
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          blob: docxBlob,
        });
        const refs = mapAgentReferences(selectedDocument.root, result.references);
        pushMessage({
          id: messageId,
          at: new Date().toISOString(),
          role: "assistant",
          kind: "digest",
          markdown,
          digest: result.digest,
          refs,
          execution: { model: result.model, elapsedMs: result.elapsedMs },
          docxUrl,
          docxFileName,
          docxFileId,
          docxBlob,
        });
        triggerPathTrace(refs);
        completed = true;
      } catch (error) {
        if (requestId === agentRequestRef.current) {
          pushError(error instanceof Error ? error.message : "The case digest agent could not complete that request.");
          setAgentStatus("failed");
        }
      } finally {
        if (requestId === agentRequestRef.current) {
          activeAgentRequestIdRef.current = null;
          if (completed) setAgentStatus("idle");
        }
      }
      return;
    }

    if (!credentials) {
      const refs = retrieveNodes(selectedDocument.root, question, 3);
      pushMessage({
        id: makeMessageId(),
        at: new Date().toISOString(),
        role: "assistant",
        kind: "references",
        query: question,
        refs,
      });
      triggerPathTrace(refs);
      return;
    }

    setAgentStatus("queued");
    const streamMessageId = makeMessageId();
    const streamStartedAt = Date.now();
    let latestAssistant = createInitialAssistantMessage();
    let completed = false;
    activeStreamMessageRef.current = streamMessageId;
    pushMessage({
      id: streamMessageId,
      at: new Date().toISOString(),
      role: "assistant",
      kind: "agent-stream",
      markdown: "",
      assistant: latestAssistant,
      execution: { model: credentials.modelId, elapsedMs: 0, startedAt: streamStartedAt },
    });
    try {
      const result = await streamChatAgent(selectedDocument.root, question, credentials, (assistant) => {
        latestAssistant = assistant;
        if (requestId !== agentRequestRef.current) return;
        setMessages((previous) => previous.map((message) => {
          if (message.id !== streamMessageId || message.kind !== "agent-stream") return message;
          return {
            ...message,
            markdown: assistantText(assistant),
            assistant,
            execution: {
              ...message.execution,
              elapsedMs: Math.max(0, Date.now() - streamStartedAt),
            },
          };
        }));
      }, requestOptions);
      if (requestId !== agentRequestRef.current) return;
      const execution: AgentExecution = {
        model: result.model,
        elapsedMs: result.elapsedMs,
        startedAt: result.startedAt ?? streamStartedAt,
        endedAt: result.endedAt ?? Date.now(),
      };
      const refs = referencesForAnswer(selectedDocument.root, result.references, question);
      setMessages((previous) => previous.map((message) => {
        if (message.id !== streamMessageId || message.kind !== "agent-stream") return message;
        return {
          ...message,
          kind: "agent-answer" as const,
          markdown: result.markdown,
          refs,
          execution,
          assistant: latestAssistant,
        };
      }));
      triggerPathTrace(refs);
      activeStreamMessageRef.current = null;
      completed = true;
    } catch (error) {
      if (requestId !== agentRequestRef.current) return;
      activeStreamMessageRef.current = null;
      setMessages((previous) => previous.filter((message) => message.id !== streamMessageId));
      pushError(error instanceof Error ? `Agent unavailable. ${error.message} Showing local matches instead.` : "Agent unavailable. Showing local matches instead.");
      const refs = retrieveNodes(selectedDocument.root, question, 3);
      pushMessage({
        id: makeMessageId(),
        at: new Date().toISOString(),
        role: "assistant",
        kind: "references",
        query: question,
        refs,
      });
      triggerPathTrace(refs);
      setAgentStatus("failed");
    } finally {
      if (activeStreamMessageRef.current === streamMessageId) activeStreamMessageRef.current = null;
      if (requestId === agentRequestRef.current) {
        activeAgentRequestIdRef.current = null;
        if (completed) setAgentStatus(digestReadyRef.current ? "complete" : "idle");
      }
    }
  }

  /** Answer a question or execute the default /digest quick action. */
  function handleAsk(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitQuestion(draft);
  }

  /** Stop this tab's running agent request without recycling the shared worker. */
  function handleCancelAgent(): void {
    stopAgent(true);
  }

  /** Reset the engine after it crashed so the next request starts fresh. */
  function handleReloadAgent(): void {
    setAgentStatus(digestReadyRef.current ? "complete" : "idle");
    disposeEngine();
  }

  function handleReferenceClick(hit: RetrievalHit): void {
    setSelectedNodeId(hit.nodeId);
    setFocusRequest({ nodeId: hit.nodeId, nonce: Date.now() });
  }

  /** Open the popup viewer for a generated digest so it can be checked first. */
  function handlePreviewDigest(message: Extract<ChatMessage, { kind: "digest" }>): void {
    if (!message.docxBlob || !message.docxUrl) return;
    setPreview({ blob: message.docxBlob, fileName: message.docxFileName, downloadUrl: message.docxUrl });
  }

  const handleGraphNodeSelect = useCallback((node: { id: string }): void => {
    setSelectedNodeId(node.id);
  }, []);

  const isBusy = status === "parsing" || agentStatus === "queued" || agentStatus === "running";

  return (
    <div
      className={`digest-session ${isDragging ? "is-dragging" : ""}`}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDrop={handleDrop}
    >
      <section className="session-chat">
        <div className="chat-log" ref={logRef}>
          {messages.map((message) => (
            <ChatBubble
              agentStatus={agentStatus}
              key={message.id}
              message={message}
              onPreviewDocx={handlePreviewDigest}
              onReferenceClick={handleReferenceClick}
            />
          ))}
        </div>

        <div className="chat-composer-shell">
          {agentStatus === "queued" && (
            <div className="agent-progress is-queued" role="status">
              <span aria-hidden="true" className="loader agent-queue-loader" />
              <span>{queuePosition === undefined ? "Waiting for the case-digest agent..." : `Queued for digest processing · position ${queuePosition}`}</span>
            </div>
          )}
          {agentStatus === "running" && (
            <div className="agent-progress" role="status">
              <span className="agent-progress-dot" />
               <span>Thinking, reading, and writing with the case-digest agent...</span>
              <button
                className="agent-progress-action"
                onClick={handleCancelAgent}
                title="Stop the agent"
                type="button"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
          {agentStatus === "failed" && (
            <div className="agent-progress is-failed" role="status">
              <span className="agent-progress-dot" />
              <span>The case-digest agent stopped unexpectedly.</span>
              <button
                className="agent-progress-action"
                onClick={handleReloadAgent}
                title="Reload the agent"
                type="button"
              >
                reload
              </button>
            </div>
          )}
          <div className="chat-quick-actions">
            <button
              className="quick-action"
              disabled={!selected || isBusy}
              onClick={() => void submitQuestion("/digest")}
              title={selected ? "Generate a structured case digest" : "Attach a PDF first"}
              type="button"
            >
              <Icon name="spark" size={13} />
              <strong>/digest</strong>
              <span>case digest</span>
            </button>
          </div>
          <form className="chat-composer" onSubmit={handleAsk}>
            <input accept=".pdf,application/pdf" className="visually-hidden" onChange={handleFileChange} ref={fileInputRef} type="file" />
            {!selected && (
              <button
                aria-label="Attach a PDF"
                className={`composer-attach ${status === "parsing" ? "is-busy" : ""}`}
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                title={status === "parsing" ? "Parsing on-device..." : "Attach a PDF"}
                type="button"
              >
                <Icon name="upload" size={17} />
              </button>
            )}
            <input
              aria-label="Ask about the document"
              autoComplete="off"
              className="composer-input"
              disabled={isBusy}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={selected ? "Ask about this document or type /digest..." : "Attach a PDF, then ask away..."}
              value={draft}
            />
            <button aria-label="Send question" className="composer-send" disabled={!draft.trim() || isBusy} type="submit">
              <Icon name="arrow-right" size={17} />
            </button>
          </form>
        </div>
      </section>

      {selected && selectedFile ? (
        <section className="reference-slice">
          <div className="slice-graph">
            <DigestGraph
              focusRequest={focusRequest}
              onSelectNode={handleGraphNodeSelect}
              selectedNodeId={selectedNodeId}
              traceRequest={traceRequest}
              tree={selected.root}
            />
          </div>
          <Suspense fallback={<aside className="pdf-viewer"><div className="pdf-viewer-loading">Preparing the source document...</div></aside>}>
            <PdfReferenceViewer
              file={selectedFile.blob}
              fileName={selectedFile.fileName}
              referenceNode={selectedNode}
            />
          </Suspense>
        </section>
      ) : (
        <aside className="reference-slice reference-empty">
          <span className="reference-empty-icon"><Icon name="book" size={26} /></span>
          <h2>The source pane is waiting.</h2>
          <p>Attach a PDF in the chat and its context map plus full document will appear here.</p>
        </aside>
      )}

      {preview && (
        <Suspense fallback={null}>
          <DocxPreviewModal
            blob={preview.blob}
            downloadUrl={preview.downloadUrl}
            fileName={preview.fileName}
            onClose={() => setPreview(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

interface ChatBubbleProps {
  agentStatus: AgentStatus;
  message: ChatMessage;
  onPreviewDocx: (message: Extract<ChatMessage, { kind: "digest" }>) => void;
  onReferenceClick: (hit: RetrievalHit) => void;
}

function ChatBubble({ agentStatus, message, onPreviewDocx, onReferenceClick }: ChatBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="chat-row is-user">
        <div className={`chat-bubble bubble-${message.kind}`}>
          {message.kind === "attachment" ? (
            <>
              <Icon name="upload" size={14} />
              <span>Digesting <strong>{message.fileName}</strong></span>
            </>
          ) : (
            <span>{message.text}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-row is-assistant">
      <span className="chat-avatar">
        {message.kind === "agent-stream" ? (
          agentStatus === "queued" ? (
            <span aria-label="Agent request is waiting in the queue" className="loader chat-avatar-loader" role="status" />
          ) : (
            <span aria-label="Agent connected and streaming" className="agent-spin chat-avatar-spin" role="status" />
          )
        ) : (
          <Icon name="tree" size={15} />
        )}
      </span>
      <div className="chat-bubble bubble-assistant">
        {message.kind === "welcome" && (
          <>
            <p><strong>Welcome to the digest bench.</strong></p>
            <p>Attach a case PDF and I will parse it entirely on your device — sections become the map above-right, and you can ask me anything about the text.</p>
          </>
        )}
        {message.kind === "nudge" && (
          <p>Attach a PDF first and I will map its structure for you.</p>
        )}
        {message.kind === "error" && (
          <p className="bubble-error">{message.text}</p>
        )}
        {message.kind === "parse-summary" && (
          <>
            <p><strong>{message.fileName}</strong> is mapped.</p>
            <div className="metric-chips">
              <span className="metric-chip">{message.pageCount} pages</span>
              <span className="metric-chip">{message.nodeCount} nodes</span>
              <span className="metric-chip">{message.ms} ms</span>
              <span className="metric-chip">{message.pdfType}</span>
            </div>
            <p className="bubble-hint">Hover nodes for (section, p#), click one to jump to the source, or ask me something below.</p>
          </>
        )}
        {message.kind === "references" && (
          message.refs.length ? (
            <>
              <p>I found {message.refs.length} matching passage{message.refs.length === 1 ? "" : "s"}:</p>
              <div className="reference-list">
                <ReferenceList refs={message.refs} onReferenceClick={onReferenceClick} />
              </div>
            </>
          ) : (
            <p>No passages matched that. Try different words from the document.</p>
          )
        )}
        {message.kind === "agent-answer" && (
          <>
            {message.assistant && <AssistantActivity message={message.assistant} />}
            <MarkdownBody markdown={message.markdown} />
            <AgentExecutionMeta execution={message.execution} />
            {message.refs.length > 0 && (
              <div className="agent-references">
                <p className="reference-heading">Sources highlighted in the document tree</p>
                <ReferenceList refs={message.refs} onReferenceClick={onReferenceClick} />
              </div>
            )}
          </>
        )}
        {message.kind === "agent-stream" && (
          <>
            <AssistantActivity isStreaming message={message.assistant} />
            {message.markdown ? (
              <MarkdownBody markdown={message.markdown} streaming />
            ) : (
              <p className="agent-stream-placeholder">The agent is reading the document...</p>
            )}
            <AgentExecutionMeta execution={message.execution} live />
          </>
        )}
        {message.kind === "digest" && (
          <>
            <MarkdownBody markdown={message.markdown} />
            {message.docxBlob && message.docxUrl ? (
              <div className="digest-download-row">
                <button className="digest-preview" onClick={() => onPreviewDocx(message)} type="button">
                  <Icon name="book" size={14} /> Preview
                </button>
                <a className="digest-download" download={message.docxFileName} href={message.docxUrl}>
                  <Icon name="upload" size={14} /> Download
                </a>
              </div>
            ) : (
              <p className="bubble-hint">The digest response is saved, but its DOCX attachment is unavailable.</p>
            )}
            <AgentExecutionMeta execution={message.execution} />
            {message.refs.length > 0 && (
              <div className="agent-references">
                <p className="reference-heading">Sources highlighted in the document tree</p>
                <ReferenceList refs={message.refs} onReferenceClick={onReferenceClick} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type AgentToolPart = Extract<AssistantMessage["parts"][number], { type: "tool-call" }>;

function AssistantActivity({ message, isStreaming = false }: { message: AssistantMessage; isStreaming?: boolean }) {
  const thinking = assistantThinking(message);
  const tools = message.parts.filter((part): part is AgentToolPart => part.type === "tool-call");
  if (!thinking && tools.length === 0) return null;

  return (
    <div className="assistant-activity">
      {thinking && (
        <details className="agent-thinking" open={isStreaming}>
          <summary><span className="agent-activity-dot is-thinking" />{isStreaming ? "Thinking" : "Reasoning"}</summary>
          <div className="agent-thinking-content">{thinking}</div>
        </details>
      )}
      {tools.map((tool) => <ToolCallActivity key={tool.toolCallId} tool={tool} isStreaming={isStreaming} />)}
    </div>
  );
}

function ToolCallActivity({ tool, isStreaming }: { tool: AgentToolPart; isStreaming: boolean }) {
  const complete = tool.result !== undefined;
  const result = tool.result === undefined ? "" : displayStreamValue(tool.result);
  return (
    <details className="agent-tool-call" open={isStreaming && !complete}>
      <summary>
        <span className={`agent-activity-dot ${complete ? "is-complete" : "is-running"}`} />
        <strong>{tool.toolName}</strong>
        <small>{complete ? "complete" : "running"}</small>
      </summary>
      {tool.argsText && (
        <div className="agent-tool-block">
          <span>Arguments</span>
          <pre>{tool.argsText}</pre>
        </div>
      )}
      {complete && (
        <div className="agent-tool-block">
          <span>Result</span>
          <pre>{result}</pre>
        </div>
      )}
    </details>
  );
}

function displayStreamValue<T>(value: T): string {
  if (Object.prototype.toString.call(value) === "[object String]") return String(value);
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}

interface ReferenceListProps {
  refs: RetrievalHit[];
  onReferenceClick: (hit: RetrievalHit) => void;
}

function ReferenceList({ refs, onReferenceClick }: ReferenceListProps) {
  return refs.map((ref) => (
    <button className="reference-item" key={ref.nodeId} onClick={() => onReferenceClick(ref)} type="button">
      <span className="reference-copy">{ref.snippet}</span>
      <span className="reference-meta">({ref.kind} · {ref.section || "root"} · p{ref.page ?? "?"})</span>
    </button>
  ));
}

function MarkdownBody({ markdown, streaming = false }: { markdown: string; streaming?: boolean }) {
  const html = DOMPurify.sanitize(marked.parse(markdown, { breaks: true, gfm: true, async: false }));
  return <div className={`markdown-body ${streaming ? "is-streaming" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function AgentExecutionMeta({ execution, live = false }: { execution: AgentExecution; live?: boolean }) {
  const description = executionDescription(execution);
  return (
    <span aria-label={description} className="agent-execution" tabIndex={0} title={description}>
      <Icon name="clock" size={13} />
      <span className="agent-execution-tooltip" role="tooltip">
        <strong>{execution.model}</strong>
        <small>{live ? "Running · " : ""}{formatExecutionTime(execution.elapsedMs)}</small>
        {execution.startedAt !== undefined && <small>start {formatExecutionTimestamp(execution.startedAt)}</small>}
        {execution.endedAt !== undefined && <small>end {formatExecutionTimestamp(execution.endedAt)}</small>}
      </span>
    </span>
  );
}
