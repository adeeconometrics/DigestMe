import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import Icon from "../components/Icon";
import DigestGraph from "../components/DigestGraph";
import { getDocument, getDocumentSummaries, putDocument, removeDocument } from "../lib/db";
import { isPdfFile, parsePdf } from "../parser";
import type { ParsedDocument } from "../parser";
import type { DocumentSummary } from "../types";

type DigestStatus = "idle" | "parsing" | "error";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

/** Case digest: upload a PDF, parse it on-device, explore its context tree. */
export default function DigestPage() {
  const [summaries, setSummaries] = useState<DocumentSummary[]>([]);
  const [selected, setSelected] = useState<ParsedDocument | null>(null);
  const [status, setStatus] = useState<DigestStatus>("idle");
  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshSummaries = useCallback(() => {
    return getDocumentSummaries()
      .then(setSummaries)
      .catch(() => setMessage("IndexedDB is unavailable, so parsed documents will not be saved."));
  }, []);

  useEffect(() => {
    void refreshSummaries();
  }, [refreshSummaries]);

  async function processPdf(file: File): Promise<void> {
    if (!isPdfFile(file)) {
      setStatus("error");
      setMessage("That file is not a PDF. Choose a file ending in .pdf.");
      return;
    }

    setStatus("parsing");
    setMessage(`Reading ${file.name} on-device...`);

    try {
      const parsed = await parsePdf(file);
      await putDocument(parsed);
      setSelected(parsed);
      setStatus("idle");
      setMessage(`${parsed.fileName} parsed into its context tree.`);
      await refreshSummaries();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "This PDF could not be parsed.");
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) void processPdf(file);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void processPdf(file);
  }

  async function handleSelect(summaryId: string): Promise<void> {
    if (selected?.id === summaryId) return;
    try {
      const document = await getDocument(summaryId);
      if (document) {
        setSelected(document);
        setStatus("idle");
        setMessage("");
      }
    } catch {
      setStatus("error");
      setMessage("That document could not be loaded from local storage.");
    }
  }

  async function handleRemove(summaryId: string): Promise<void> {
    try {
      await removeDocument(summaryId);
      if (selected?.id === summaryId) setSelected(null);
      await refreshSummaries();
    } catch {
      setStatus("error");
      setMessage("The document could not be removed from local storage.");
    }
  }

  const totalPages = summaries.reduce((sum, summary) => sum + summary.pageCount, 0);

  return (
    <div className="page digest-page">
      <section className="library-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> case digest</div>
          <h1>Digest your <em>cases.</em></h1>
          <p>Drop in a PDF and watch its sections become a map you can hover, zoom, and revisit.</p>
        </div>
        <span className="digest-local-note"><Icon name="check" size={14} /> parsed on-device, nothing is uploaded</span>
      </section>

      <section className="library-stats">
        <div className="library-stat"><span className="stat-icon mint"><Icon name="tree" size={18} /></span><span><strong>{summaries.length}</strong><small>documents digested</small></span></div>
        <div className="library-stat"><span className="stat-icon peach"><Icon name="book" size={18} /></span><span><strong>{totalPages}</strong><small>pages mapped</small></span></div>
        <div className="library-stat"><span className="stat-icon lilac"><Icon name="spark" size={18} /></span><span><strong>{selected ? `${selected.metrics.pdfType}` : "—"}</strong><small>last parse type</small></span></div>
      </section>

      <label
        className={`pdf-drop ${isDragging ? "is-dragging" : ""}`}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDrop={handleDrop}
      >
        <input accept=".pdf,application/pdf" className="visually-hidden" onChange={handleFileChange} ref={fileInputRef} type="file" />
        <span className="pdf-drop-icon"><Icon name="upload" size={20} /></span>
        <span className="pdf-drop-copy">
          <strong>{status === "parsing" ? "Parsing your document..." : "Drop a case PDF here"}</strong>
          <small>or <button onClick={(event) => { event.preventDefault(); fileInputRef.current?.click(); }} type="button">browse files</button> · runs locally with pdf-inspector</small>
        </span>
        {status === "parsing" && <span className="pdf-drop-spinner" aria-label="Parsing" />}
      </label>

      {message && <div className={`digest-status ${status === "error" ? "is-error" : ""}`} role="status">{message}</div>}

      <div className="digest-layout">
        <aside className="digest-docs">
          <div className="panel-heading"><span>parsed documents</span><Icon name="layers" size={16} /></div>
          {summaries.length ? summaries.map((summary) => (
            <div className={`doc-row ${selected?.id === summary.id ? "selected" : ""}`} key={summary.id}>
              <button className="doc-row-button" onClick={() => void handleSelect(summary.id)} type="button">
                <span className="doc-row-icon"><Icon name="tree" size={16} /></span>
                <span className="doc-row-copy">
                  <strong>{summary.fileName}</strong>
                  <small>{summary.pageCount} pages · {summary.nodeCount} nodes · {formatDate(summary.parsedAt)}</small>
                </span>
              </button>
              <button aria-label={`Remove ${summary.fileName}`} className="doc-row-remove" onClick={() => void handleRemove(summary.id)} type="button"><Icon name="trash" size={14} /></button>
            </div>
          )) : (
            <p className="digest-docs-empty">Nothing digested yet. Your parsed documents will live here, stored in IndexedDB on this device.</p>
          )}
        </aside>

        <section className="graph-panel">
          {selected ? (
            <>
              <div className="graph-panel-heading">
                <div>
                  <h2>{selected.fileName}</h2>
                  <div className="metric-chips">
                    <span className="metric-chip">{selected.metrics.pageCount} pages</span>
                    <span className="metric-chip">{formatBytes(selected.fileSizeBytes)}</span>
                    <span className="metric-chip">{selected.metrics.processingTimeMs} ms parse</span>
                    <span className="metric-chip">pdf-inspector v{selected.parserVersion}</span>
                  </div>
                </div>
                <span className="graph-hint">hover a node to see (section, p#)</span>
              </div>
              <DigestGraph tree={selected.root} />
            </>
          ) : (
            <div className="graph-empty">
              <span className="graph-empty-icon"><Icon name="tree" size={26} /></span>
              <h2>Your context map is waiting.</h2>
              <p>Upload a PDF above or pick a previously digested document to see its structure.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
