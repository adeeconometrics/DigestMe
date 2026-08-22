import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";import * as pdfjs from "pdfjs-dist";
import Icon from "./Icon";
import type { DocumentNode } from "../parser";
import { indexDocumentPage, locateReference } from "../pdf/reference";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PAGE_RENDER_WIDTH = 620; // CSS pixels
const DEFAULT_PAGE_RATIO = 1.35;

interface PdfReferenceViewerProps {
  file: Blob;
  fileName: string;
  /** Node clicked in the graph; drives scroll + red-box highlight. */
  referenceNode: DocumentNode | null;
}

interface ActiveHighlight {
  pageNumber: number;
  matched: boolean;
}

/**
 * Renders the stored PDF next to the graph. Clicking a tree node scrolls the
 * source page into view and draws a 2pt red box around the region the
 * reference was parsed from.
 */
export default function PdfReferenceViewer({ file, fileName, referenceNode }: PdfReferenceViewerProps) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderedPages = useRef<Set<number>>(new Set());
  const renderTasks = useRef<Map<number, Promise<void>>>(new Map());
  const [pageCount, setPageCount] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [highlight, setHighlight] = useState<ActiveHighlight | null>(null);
  const [error, setError] = useState("");

  /** Renders a page canvas into its wrapper once; concurrent calls share one task. */
  const ensurePageRendered = useCallback(async (pageNumber: number): Promise<void> => {
    const doc = docRef.current;
    const container = pagesRef.current;
    if (!doc || !container || renderedPages.current.has(pageNumber)) return;

    const pending = renderTasks.current.get(pageNumber);
    if (pending) return pending;

    const task = (async (): Promise<void> => {
      const wrapper = container.querySelector<HTMLElement>(`[data-page="${pageNumber}"]`);
      if (!wrapper) return;

      const page = await doc.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = PAGE_RENDER_WIDTH / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.dataset.baseWidth = String(baseViewport.width);

      wrapper.style.aspectRatio = String(viewport.width / viewport.height);
      wrapper.appendChild(canvas);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      renderedPages.current.add(pageNumber);
    })();

    renderTasks.current.set(pageNumber, task);
    try {
      await task;
    } finally {
      renderTasks.current.delete(pageNumber);
    }
  }, []);

  // Load the document whenever the underlying bytes change.
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setError("");
      setPageCount(0);
      setHighlight(null);
      setVisiblePage(1);
      renderedPages.current.clear();
      renderTasks.current.clear();
      if (taskRef.current) void taskRef.current.destroy();
      taskRef.current = null;
      docRef.current = null;
      if (pagesRef.current) pagesRef.current.innerHTML = "";

      try {
        const bytes = await file.arrayBuffer();
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
        taskRef.current = task;
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        docRef.current = doc;

        // Placeholder wrappers up front: they reserve layout space, give the
        // scroll observer anchors, and keep page order stable while rendering.
        const container = pagesRef.current;
        if (container) {
          for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
            const wrapper = document.createElement("div");
            wrapper.className = "pdf-page";
            wrapper.dataset.page = String(pageNumber);
            wrapper.style.aspectRatio = String(1 / DEFAULT_PAGE_RATIO);
            container.appendChild(wrapper);
          }
        }
        setPageCount(doc.numPages);
      } catch {
        if (!cancelled) setError("This PDF could not be rendered in the browser.");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Tear down pdf.js on unmount.
  useEffect(() => () => { void taskRef.current?.destroy(); }, []);

  // Progressive rendering: paint nearby pages as the user scrolls.
  useEffect(() => {
    const container = pagesRef.current;
    if (!container || !pageCount) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pageNumber = Number((entry.target as HTMLElement).dataset.page);
          if (Number.isFinite(pageNumber)) void ensurePageRendered(pageNumber);
        }
      },
      { root: container, rootMargin: "700px 0px" },
    );
    container.querySelectorAll<HTMLElement>(".pdf-page").forEach((page) => observer.observe(page));

    let frame = 0;
    const onScroll = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = container.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        for (const child of Array.from(container.children)) {
          const childRect = (child as HTMLElement).getBoundingClientRect();
          if (childRect.top <= middle && childRect.bottom >= middle) {
            setVisiblePage(Number((child as HTMLElement).dataset.page));
            break;
          }
        }
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pageCount, ensurePageRendered]);

  // Core behavior: a selected node rolls the right page in and boxes its region.
  useEffect(() => {
    const doc = docRef.current;
    const container = pagesRef.current;
    if (!referenceNode || !doc || !container || !pageCount) return;
    let cancelled = false;

    async function reveal(): Promise<void> {
      if (!doc || !referenceNode) return;
      const clampedPage = Math.min(Math.max(referenceNode.page ?? 1, 1), doc.numPages);

      // Render sequentially so wrappers gain real heights before scrolling.
      for (let pageNumber = 1; pageNumber <= clampedPage; pageNumber += 1) {
        await ensurePageRendered(pageNumber);
        if (cancelled) return;
      }

      const index = await indexDocumentPage(doc, referenceNode.page ?? 1).catch(() => null);
      const match = index ? locateReference(index, referenceNode) : null;
      if (cancelled) return;

      setHighlight({ pageNumber: match ? match.pageNumber : clampedPage, matched: Boolean(match) });
      drawHighlight(container!, match?.pageNumber ?? clampedPage, match?.box ?? null);

      container!
        .querySelector(`[data-page="${clampedPage}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    void reveal();
    return () => {
      cancelled = true;
    };
  }, [referenceNode, pageCount, ensurePageRendered]);

  return (
    <aside className="pdf-viewer">
      <div className="pdf-viewer-header">
        <div className="pdf-viewer-title">
          <span className="pdf-viewer-icon"><Icon name="book" size={15} /></span>
          <span><strong>Source</strong><small>{fileName}</small></span>
        </div>
        <span className="pdf-viewer-page">p{visiblePage}{pageCount ? ` / ${pageCount}` : ""}</span>
      </div>

      <div className={`pdf-viewer-reference ${highlight && !highlight.matched ? "is-approximate" : ""}`} role="status">
        {!referenceNode ? (
          <>Click a node to see where it comes from.</>
        ) : highlight?.matched ? (
          <>Referencing <strong>p{highlight.pageNumber}</strong> · region highlighted</>
        ) : (
          <>Showing <strong>p{referenceNode.page ?? 1}</strong> · exact region not matched</>
        )}
      </div>

      {error && <div className="pdf-viewer-error">{error}</div>}
      {!error && !pageCount && <div className="pdf-viewer-loading">Preparing the source document...</div>}

      <div ref={pagesRef} className="pdf-viewer-pages" />
    </aside>
  );
}

/** Draws (or clears) the 2pt red box over a page's referenced region. */
function drawHighlight(container: HTMLElement, pageNumber: number, box: { left: number; top: number; width: number; height: number } | null): void {
  container.querySelectorAll(".pdf-highlight").forEach((element) => element.remove());
  if (!box) return;

  const wrapper = container.querySelector<HTMLElement>(`[data-page="${pageNumber}"]`);
  const canvas = wrapper?.querySelector<HTMLCanvasElement>("canvas");
  if (!wrapper || !canvas) return;

  const pxPerPoint = canvas.clientWidth / Number(canvas.dataset.baseWidth ?? PAGE_RENDER_WIDTH);
  const marker = document.createElement("div");
  marker.className = "pdf-highlight";
  marker.style.left = `${box.left * pxPerPoint - 3}px`;
  marker.style.top = `${box.top * pxPerPoint - 3}px`;
  marker.style.width = `${box.width * pxPerPoint + 6}px`;
  marker.style.height = `${box.height * pxPerPoint + 6}px`;
  wrapper.appendChild(marker);
}
