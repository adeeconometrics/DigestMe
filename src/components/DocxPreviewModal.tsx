import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import Icon from "./Icon";

type RenderStatus = "rendering" | "ready" | "error";

function fitDocxPages(renderContainer: HTMLDivElement): void {
  const wrapper = renderContainer.querySelector<HTMLElement>(".digest-doc-wrapper");
  const pages = Array.from(renderContainer.querySelectorAll<HTMLElement>(".digest-doc-wrapper > section.digest-doc"));
  if (!wrapper || pages.length === 0) return;

  const wrapperStyle = window.getComputedStyle(wrapper);
  const horizontalPadding = (Number.parseFloat(wrapperStyle.paddingLeft) || 0) + (Number.parseFloat(wrapperStyle.paddingRight) || 0);
  const availableWidth = renderContainer.clientWidth - horizontalPadding;
  if (availableWidth <= 0) return;

  const pageWidth = Math.max(...pages.map((page) => page.offsetWidth));
  const scale = pageWidth > 0 ? Math.min(1, availableWidth / pageWidth) : 1;
  // CSS zoom scales layout dimensions too, keeping the scroll area aligned with the visible page.
  for (const page of pages) page.style.setProperty("zoom", String(scale));
}

interface DocxPreviewModalProps {
  /** The generated DOCX to render, kept in memory (never re-fetched). */
  blob: Blob;
  fileName: string;
  /** Object URL used by the modal's download button. */
  downloadUrl: string;
  onClose: () => void;
}

/**
 * Popup viewer for a generated case digest. Renders the DOCX to HTML with
 * docx-preview entirely on-device; Escape, the close button, and a backdrop
 * click all dismiss it, and the footer keeps the download action one click away.
 */
export default function DocxPreviewModal({ blob, fileName, downloadUrl, onClose }: DocxPreviewModalProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<RenderStatus>("rendering");

  // Render the DOCX once per open; re-renders (StrictMode) start from a clean body.
  useEffect(() => {
    const container = bodyRef.current;
    if (!container) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    setStatus("rendering");
    void renderAsync(blob, container, undefined, {
      className: "digest-doc",
      useBase64URL: true,
    })
      .then(() => {
        if (cancelled) return;
        fitDocxPages(container);
        const viewport = container.parentElement;
        if (viewport && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => fitDocxPages(container));
          resizeObserver.observe(viewport);
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      container.innerHTML = "";
    };
  }, [blob]);

  // Escape closes; lock background scroll; move focus into the dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop docx-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section aria-labelledby="docx-preview-title" aria-modal="true" className="docx-preview-dialog" role="dialog">
        <div className="dialog-header">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> document preview</div>
            <h2 id="docx-preview-title">Generated <em>digest.</em></h2>
            <p>{fileName}</p>
          </div>
          <button aria-label="Close preview" className="dialog-close" onClick={onClose} ref={closeButtonRef} type="button">
            <Icon name="close" size={19} />
          </button>
        </div>

        <div className="docx-preview-body">
          <div className="docx-preview-render" ref={bodyRef} />
          {status === "rendering" && <div className="docx-preview-status">Rendering the document...</div>}
          {status === "error" && <div className="docx-preview-status is-error">This document could not be rendered in the browser.</div>}
        </div>

        <div className="dialog-footer">
          <span className="format-hint"><Icon name="lock" size={14} /> Rendered on-device</span>
          <div className="dialog-actions">
            <button className="text-button" onClick={onClose} type="button">Close</button>
            <a className="primary-button" download={fileName} href={downloadUrl}>
              <Icon name="upload" size={15} /> Download DOCX
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
