"use client";

import "katex/dist/katex.min.css";
import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { TutorSource } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Turns [S3] into a link token (outside code) so the Markdown renderer can draw a citation chip for it. */
function linkCitations(text: string) {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\[(S\d{1,2})\]/g, "[$1](#cite-$1)")))
    .join("");
}

export function CitationChip({ source, index, onOpen }: { source?: TutorSource; index: string; onOpen?: (source: TutorSource) => void }) {
  const label = source
    ? `${source.materialTitle} — ${source.pageStart === source.pageEnd ? `page ${source.pageStart}` : `pages ${source.pageStart}–${source.pageEnd}`}`
    : "Source";
  return (
    <button
      type="button"
      onClick={() => source && onOpen?.(source)}
      className={cn(
        "mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-md px-1 align-middle text-[10.5px] font-semibold leading-none transition-colors",
        "bg-blue-100 text-blue-700 ring-1 ring-blue-600/15 hover:bg-blue-600 hover:text-white",
      )}
      title={label}
      aria-label={`Open source: ${label}`}
    >
      {index.replace("S", "")}
    </button>
  );
}

function AnswerMarkdownImpl({
  content,
  sources,
  onOpenSource,
  streaming,
  className,
}: {
  content: string;
  sources: TutorSource[];
  onOpenSource?: (source: TutorSource) => void;
  streaming?: boolean;
  className?: string;
}) {
  const bySource = useMemo(() => new Map(sources.map((s) => [s.ref, s])), [sources]);
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        if (href?.startsWith("#cite-")) {
          const ref = href.slice(6);
          return <CitationChip index={ref} source={bySource.get(ref)} onOpen={onOpenSource} />;
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        );
      },
    }),
    [bySource, onOpenSource],
  );

  return (
    <div className={cn("zoya-prose", streaming && "is-streaming", className)}>
      {/* Raw HTML in model output is never rendered (react-markdown default). */}
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
        {linkCitations(content)}
      </ReactMarkdown>
    </div>
  );
}

export const AnswerMarkdown = memo(AnswerMarkdownImpl);
