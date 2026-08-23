import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import Icon from "../components/Icon";
import DigestGraph from "../components/DigestGraph";
import { getDocumentWithSource, putDocumentWithFile } from "../lib/db";
import type { StoredDocumentFile } from "../lib/db";
import { caseDigestFileName, renderCaseDigestDocx } from "../lib/caseDigestDocx";
import type { CaseDigest } from "../lib/caseDigestDocx";
import { caseDigestToMarkdown } from "../lib/caseDigestMarkdown";
import { getAgentRuntimeCredentials } from "../lib/agentSettings";
import { flattenTree, isPdfFile, parsePdf } from "../parser";
import type { DocumentNode, ParsedDocument } from "../parser";
import { referencesForAnswer, executionDescription, formatExecutionTime, mapAgentReferences } from "../chat/agentChat";
import { retrieveNodes } from "../chat/retrieval";
import type { RetrievalHit } from "../chat/retrieval";
import { disposeEngine, runCaseDigestAgent, runChatAgent, subscribeEngineStatus } from "../pyodide/engineLoader";
import type { AgentExecution } from "../pyodide/types";

const PdfReferenceViewer = lazy(() => import("../components/PdfReferenceViewer"));
const DocxPreviewModal = lazy(() => import("../components/DocxPreviewModal"));

type DigestStatus = "idle" | "parsing" | "error";
type AgentStatus = "idle" | "running" | "failed";

interface ChatMessageBase {
  id: string;
  at: string;
}

type ChatMessage =
  | (ChatMessageBase & { role: "assistant"; kind: "welcome" })
  | (ChatMessageBase & { role: "assistant"; kind: "nudge" })
  | (ChatMessageBase & { role: "assistant"; kind: "error"; text: string })
  | (ChatMessageBase & { role: "user"; kind: "attachment"; fileName: string })
  | (ChatMessageBase & { role: "user"; kind: "question"; text: string })
  | (ChatMessageBase & {
      role: "assistant";
      kind: "parse-summary";
      fileName: string;
      pageCount: number;
      nodeCount: number;
      ms: number;
      pdfType: string;
    })
  | (ChatMessageBase & { role: "assistant"; kind: "references"; query: string; refs: RetrievalHit[] })
  | (ChatMessageBase & {
      role: "assistant";
      kind: "agent-answer";
      markdown: string;
      refs: RetrievalHit[];
      execution: AgentExecution;
    })
  | (ChatMessageBase & {
      role: "assistant";
      kind: "digest";
      markdown: string;
      digest: CaseDigest;
      refs: RetrievalHit[];
      execution: AgentExecution;
      docxUrl: string;
      docxFileName: string;
      docxBlob: Blob;
    });

function makeMessageId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `msg-${randomId ?? Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function welcomeMessage(): ChatMessage {
  return { id: makeMessageId(), at: new Date().toISOString(), role: "assistant", kind: "welcome" };
}

interface DigestPreview {
  blob: Blob;
  fileName: string;
  downloadUrl: string;
}

interface DigestPageProps {
  /** Incremented by the sidebar "New session" action; resets the thread. */
  sessionToken?: number;
  /** Sidebar request to open a previously digested document. */
  focusDoc?: { id: string; nonce: number } | null;
}

/** Case digest: a chat session over a locally parsed PDF. */
export default function DigestPage({ sessionToken = 0, focusDoc = null }: DigestPageProps) {
  const [selected, setSelected] = useState<ParsedDocument | null>(null);
  const [selectedFile, setSelectedFile] = useState<StoredDocumentFile | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; nonce: number } | null>(null);
  const [status, setStatus] = useState<DigestStatus>("idle");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage()]);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<DigestPreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const agentRequestRef = useRef(0);
  const docxUrlsRef = useRef<Set<string>>(new Set());

  const selectedNode: DocumentNode | null = useMemo(() => {
    if (!selected || !selectedNodeId) return null;
    return flattenTree(selected.root).find((node) => node.id === selectedNodeId) ?? null;
  }, [selected, selectedNodeId]);

  const pushMessage = useCallback((message: ChatMessage): void => {
    setMessages((previous) => [...previous, message]);
  }, []);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  // Surface engine crashes as a persistent "failed" state, and clear it once a
  // reload resets the engine. In-flight requests set their own "running" state.
  useEffect(
    () =>
      subscribeEngineStatus((nextStatus) => {
        setAgentStatus((current) => {
          if (nextStatus.state === "failed") return "failed";
          if (nextStatus.state === "idle" && current === "failed") return "idle";
          return current;
        });
      }),
    [],
  );

  useEffect(
    () => () => {
      agentRequestRef.current += 1;
      disposeEngine();
      for (const url of docxUrlsRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  // Sidebar "New session": clear the thread and selection.
  const firstSessionToken = useRef(sessionToken);
  useEffect(() => {
    if (sessionToken === firstSessionToken.current) return;
    agentRequestRef.current += 1;
    setSelected(null);
    setSelectedFile(null);
    setSelectedNodeId(null);
    setStatus("idle");
    setAgentStatus("idle");
    setMessages([welcomeMessage()]);
  }, [sessionToken]);

  // Sidebar session list: open a stored document on demand.
  const lastFocusNonce = useRef(0);
  useEffect(() => {
    if (!focusDoc || focusDoc.nonce === lastFocusNonce.current) return;
    lastFocusNonce.current = focusDoc.nonce;
    void handleSelect(focusDoc.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDoc]);

  const pushError = useCallback((text: string): void => {
    pushMessage({ id: makeMessageId(), at: new Date().toISOString(), role: "assistant", kind: "error", text });
  }, [pushMessage]);

  function openSession(parsed: ParsedDocument, file: StoredDocumentFile): void {
    agentRequestRef.current += 1;
    setAgentStatus("idle");
    setSelected(parsed);
    setSelectedFile(file);
    setSelectedNodeId(null);
    setStatus("idle");
    pushMessage({ id: makeMessageId(), at: new Date().toISOString(), role: "user", kind: "attachment", fileName: parsed.fileName });
    pushMessage({
      id: makeMessageId(),
      at: new Date().toISOString(),
      role: "assistant",
      kind: "parse-summary",
      fileName: parsed.fileName,
      pageCount: parsed.metrics.pageCount,
      nodeCount: flattenTree(parsed.root).length,
      ms: parsed.metrics.processingTimeMs,
      pdfType: parsed.metrics.pdfType,
    });
  }

  async function processPdf(file: File): Promise<void> {
    if (!isPdfFile(file)) {
      pushError("That file is not a PDF — choose one ending in .pdf.");
      return;
    }

    setStatus("parsing");
    try {
      const parsed = await parsePdf(file);
      const stored: StoredDocumentFile = { id: parsed.id, fileName: file.name, mimeType: file.type || "application/pdf", blob: file };
      await putDocumentWithFile(parsed, file);
      openSession(parsed, stored);
    } catch (error) {
      setStatus("error");
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

  async function handleSelect(summaryId: string): Promise<void> {
    if (selected?.id === summaryId) return;
    agentRequestRef.current += 1;
    setAgentStatus("idle");
    try {
      const source = await getDocumentWithSource(summaryId);
      if (source) {
        setSelected(source.document);
        setSelectedFile(source.file);
        setSelectedNodeId(null);
        setStatus("idle");
        pushMessage({ id: makeMessageId(), at: new Date().toISOString(), role: "user", kind: "attachment", fileName: source.document.fileName });
        pushMessage({
          id: makeMessageId(),
          at: new Date().toISOString(),
          role: "assistant",
          kind: "parse-summary",
          fileName: source.document.fileName,
          pageCount: source.document.metrics.pageCount,
          nodeCount: flattenTree(source.document.root).length,
          ms: source.document.metrics.processingTimeMs,
          pdfType: source.document.metrics.pdfType,
        });
      }
    } catch {
      setStatus("error");
      pushError("That document could not be loaded from local storage.");
    }
  }

  function isDigestCommand(question: string): boolean {
    return question.trim().toLowerCase() === "/digest";
  }

  async function submitQuestion(rawQuestion: string): Promise<void> {
    if (status === "parsing" || agentStatus === "running") return;
    const question = rawQuestion.trim();
    if (!question) return;
    const requestId = ++agentRequestRef.current;
    const selectedDocument = selected;

    setDraft("");
    pushMessage({ id: makeMessageId(), at: new Date().toISOString(), role: "user", kind: "question", text: question });

    if (!selectedDocument) {
      pushMessage({ id: makeMessageId(), at: new Date().toISOString(), role: "assistant", kind: "nudge" });
      return;
    }

    const credentials = await getAgentRuntimeCredentials().catch(() => null);
    if (requestId !== agentRequestRef.current) return;

    if (isDigestCommand(question)) {
      if (!credentials) {
        pushError("Save an OpenRouter model and API key in Settings before running /digest.");
        return;
      }

      setAgentStatus("running");
      try {
        const result = await runCaseDigestAgent(selectedDocument.root, credentials);
        if (requestId !== agentRequestRef.current) return;

        const markdown = caseDigestToMarkdown(result.digest);
        const docxBlob = await renderCaseDigestDocx(result.digest);
        if (requestId !== agentRequestRef.current) return;
        const docxUrl = URL.createObjectURL(docxBlob);
        docxUrlsRef.current.add(docxUrl);
        pushMessage({
          id: makeMessageId(),
          at: new Date().toISOString(),
          role: "assistant",
          kind: "digest",
          markdown,
          digest: result.digest,
          refs: mapAgentReferences(selectedDocument.root, result.references),
          execution: { model: result.model, elapsedMs: result.elapsedMs },
          docxUrl,
          docxFileName: caseDigestFileName(result.digest.case_title),
          docxBlob,
        });
      } catch (error) {
        if (requestId === agentRequestRef.current) {
          pushError(error instanceof Error ? error.message : "The case digest agent could not complete that request.");
        }
      } finally {
        if (requestId === agentRequestRef.current) setAgentStatus("idle");
      }
      return;
    }

    if (!credentials) {
      pushMessage({
        id: makeMessageId(),
        at: new Date().toISOString(),
        role: "assistant",
        kind: "references",
        query: question,
        refs: retrieveNodes(selectedDocument.root, question, 3),
      });
      return;
    }

    setAgentStatus("running");
    try {
      const result = await runChatAgent(selectedDocument.root, question, credentials);
      if (requestId !== agentRequestRef.current) return;
      pushMessage({
        id: makeMessageId(),
        at: new Date().toISOString(),
        role: "assistant",
        kind: "agent-answer",
        markdown: result.markdown,
        refs: referencesForAnswer(selectedDocument.root, result.references, question),
        execution: { model: result.model, elapsedMs: result.elapsedMs },
      });
    } catch (error) {
      if (requestId !== agentRequestRef.current) return;
      pushError(error instanceof Error ? `Agent unavailable. ${error.message} Showing local matches instead.` : "Agent unavailable. Showing local matches instead.");
      pushMessage({
        id: makeMessageId(),
        at: new Date().toISOString(),
        role: "assistant",
        kind: "references",
        query: question,
        refs: retrieveNodes(selectedDocument.root, question, 3),
      });
    } finally {
      if (requestId === agentRequestRef.current) setAgentStatus("idle");
    }
  }

  /** Answer a question or execute the default /digest quick action. */
  function handleAsk(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitQuestion(draft);
  }

  /** Stop a running agent request and tear down the worker. */
  function handleCancelAgent(): void {
    agentRequestRef.current += 1;
    setAgentStatus("idle");
    disposeEngine();
  }

  /** Reset the engine after it crashed so the next request starts fresh. */
  function handleReloadAgent(): void {
    setAgentStatus("idle");
    disposeEngine();
  }

  function handleReferenceClick(hit: RetrievalHit): void {
    setSelectedNodeId(hit.nodeId);
    setFocusRequest({ nodeId: hit.nodeId, nonce: Date.now() });
  }

  /** Open the popup viewer for a generated digest so it can be checked first. */
  function handlePreviewDigest(message: Extract<ChatMessage, { kind: "digest" }>): void {
    setPreview({ blob: message.docxBlob, fileName: message.docxFileName, downloadUrl: message.docxUrl });
  }

  function handleGraphNodeSelect(node: { id: string }): void {
    setSelectedNodeId(node.id);
  }

  const isBusy = status === "parsing" || agentStatus === "running";

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
        <header className="session-header">
          <div className="session-title">
            <span className="session-mark"><Icon name="spark" size={16} /></span>
            <div>
              <strong>{selected ? selected.fileName : "Case digest session"}</strong>
              <small>{selected ? `${selected.metrics.pageCount} pages · parsed on-device` : "attach a case file to begin"}</small>
            </div>
          </div>
          {selected && (
            <span className="session-badge"><Icon name="check" size={12} /> local</span>
          )}
        </header>

        <div className="chat-log" ref={logRef}>
          {messages.map((message) => (
            <ChatBubble
              key={message.id}
              message={message}
              onPreviewDocx={handlePreviewDigest}
              onReferenceClick={handleReferenceClick}
            />
          ))}
        </div>

        <div className="chat-composer-shell">
          {agentStatus === "running" && (
            <div className="agent-progress" role="status">
              <span className="agent-progress-dot" />
              <span>Reading the document with the case-digest agent...</span>
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
  message: ChatMessage;
  onPreviewDocx: (message: Extract<ChatMessage, { kind: "digest" }>) => void;
  onReferenceClick: (hit: RetrievalHit) => void;
}

function ChatBubble({ message, onPreviewDocx, onReferenceClick }: ChatBubbleProps) {
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
      <span className="chat-avatar"><Icon name="tree" size={15} /></span>
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
        {message.kind === "digest" && (
          <>
            <MarkdownBody markdown={message.markdown} />
            <div className="digest-download-row">
              <button className="digest-preview" onClick={() => onPreviewDocx(message)} type="button">
                <Icon name="book" size={14} /> Preview
              </button>
              <a className="digest-download" download={message.docxFileName} href={message.docxUrl}>
                <Icon name="upload" size={14} /> Download
              </a>
            </div>
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

function MarkdownBody({ markdown }: { markdown: string }) {
  const html = DOMPurify.sanitize(marked.parse(markdown, { breaks: true, gfm: true, async: false }));
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

function AgentExecutionMeta({ execution }: { execution: AgentExecution }) {
  const description = executionDescription(execution);
  return (
    <span aria-label={description} className="agent-execution" tabIndex={0} title={description}>
      <Icon name="clock" size={13} />
      <span className="agent-execution-tooltip" role="tooltip">
        <strong>{execution.model}</strong>
        <small>{formatExecutionTime(execution.elapsedMs)}</small>
      </span>
    </span>
  );
}
