"use client";

import { ChevronLeft, ChevronRight, ExternalLink, FileText, ScanText, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { useMaterialPage } from "@/lib/queries";
import type { TutorSource } from "@/lib/types";

/** What the viewer needs: a Tutor answer's source, or a quiz question's. */
export type ViewableSource = Pick<TutorSource, "materialId" | "materialTitle" | "pageStart" | "pageEnd" | "sectionTitle" | "snippet"> & {
  flagged?: boolean;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Finds the cited passage in the page text, tolerant of line breaks (snippets are whitespace-normalised). */
function locate(text: string, snippet: string): [number, number] | null {
  const truncated = snippet.endsWith("…");
  const words = snippet.replace(/…$/, "").split(/\s+/).filter(Boolean);
  if (truncated) words.pop(); // the last word may be cut in half
  for (const count of [words.length, 24, 10]) {
    if (count < 4 || words.length < 4) break;
    const match = new RegExp(words.slice(0, count).map(escapeRegex).join("\\s+")).exec(text);
    if (match) return [match.index, match.index + match[0].length];
  }
  return null;
}

function Highlighted({ text, snippet }: { text: string; snippet: string }) {
  const range = locate(text, snippet);
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range[0])}
      <mark className="rounded bg-amber-100 px-0.5 text-ink">{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  );
}

/**
 * "Return to the original material" (PRD §7): the cited page's text with the passage highlighted, page
 * navigation, and a link that opens the PDF itself at that page.
 */
export function SourceViewer({
  projectId,
  source,
  onClose,
}: {
  projectId: string;
  source: ViewableSource | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(source)}
      onOpenChange={(open) => !open && onClose()}
      title={source ? source.materialTitle : "Source"}
      description={source?.sectionTitle ?? undefined}
      size="lg"
    >
      {source && <SourcePages key={`${source.materialId}:${source.pageStart}`} projectId={projectId} source={source} />}
    </Dialog>
  );
}

function SourcePages({ projectId, source }: { projectId: string; source: ViewableSource }) {
  const [page, setPage] = useState(source.pageStart);
  const { data, isLoading, error, refetch } = useMaterialPage(projectId, source.materialId, page);
  const pdfUrl = `/api/projects/${projectId}/materials/${source.materialId}/file#page=${page}`;
  const isCitedPage = page >= source.pageStart && page <= source.pageEnd;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 font-medium text-blue-700">
            <FileText className="size-4" />
            Page {page}
            {data?.pageCount ? <span className="font-normal text-blue-600/70">of {data.pageCount}</span> : null}
          </span>
          {data?.method === "ocr" && (
            <span className="inline-flex items-center gap-1 text-xs text-muted" title="This page was scanned; its text was recognised with OCR">
              <ScanText className="size-3.5" /> OCR
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={buttonClasses("secondary", "icon")}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className={buttonClasses("secondary", "icon")}
            onClick={() => setPage((p) => p + 1)}
            disabled={Boolean(data?.pageCount && page >= data.pageCount)}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </button>
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses("primary", "sm")}>
            <ExternalLink className="size-3.5" />
            Open PDF
          </a>
        </div>
      </div>

      {source.flagged && isCitedPage && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          This passage contains instruction-like text. Zoya treats material strictly as information and never follows instructions
          found in documents.
        </p>
      )}

      <div className="scrollbar-thin max-h-[55vh] overflow-y-auto rounded-xl border border-line bg-slate-50/60 p-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4" />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
            {data?.text ? isCitedPage ? <Highlighted text={data.text} snippet={source.snippet} /> : data.text : "This page has no text."}
          </p>
        )}
      </div>
      <p className="text-xs text-muted">
        Cited as <span className="font-medium text-ink-soft">Source: {source.materialTitle} — Page {source.pageStart}</span>
        {source.pageEnd !== source.pageStart ? `–${source.pageEnd}` : ""}
      </p>
    </div>
  );
}
