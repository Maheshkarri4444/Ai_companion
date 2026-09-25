"use client";

import {
  AlertTriangle,
  BookOpenCheck,
  Check,
  Copy,
  FileText,
  Globe2,
  Loader2,
  RotateCcw,
  SearchX,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Upload,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { ZoyaAvatar } from "@/components/zoya/zoya-avatar";
import { errorMessage } from "@/lib/api";
import { useTutorFeedback } from "@/lib/queries";
import type { TutorAction, TutorMessage, TutorSource } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AnswerMarkdown } from "./answer-markdown";

export const ACTION_LABELS: Record<TutorAction, string> = {
  simplify: "Explain it more simply",
  example: "Give me an example",
  check_understanding: "Test my understanding",
  summarize: "Summarize the key points",
  revision: "Help me revise",
  general_knowledge: "Answer from general knowledge",
};

const pages = (s: { pageStart: number; pageEnd: number }) =>
  s.pageStart === s.pageEnd ? `Page ${s.pageStart}` : `Pages ${s.pageStart}–${s.pageEnd}`;

export function UserBubble({ content, action, mode }: { content: string; action: TutorAction | null; mode: "auto" | "general" }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1.5 sm:max-w-[75%]">
        {(action || mode === "general") && (
          <p className="flex items-center justify-end gap-1 text-[11px] font-medium text-blue-700">
            {mode === "general" ? <Globe2 className="size-3" /> : <Sparkles className="size-3" />}
            {mode === "general" ? "General knowledge requested" : ACTION_LABELS[action as TutorAction]}
          </p>
        )}
        <div className="rounded-2xl rounded-tr-md bg-linear-to-br from-blue-600 to-indigo-600 px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-white shadow-[0_8px_20px_-10px_rgb(37_99_235/0.8)]">
          {content}
        </div>
      </div>
    </div>
  );
}

export function GroundingBadge({ grounding }: { grounding: TutorMessage["grounding"] }) {
  if (!grounding?.status) return null;
  if (grounding.degraded) {
    return (
      <Badge tone="amber">
        <AlertTriangle className="size-3" /> AI unavailable — showing passages
      </Badge>
    );
  }
  switch (grounding.status) {
    case "grounded":
      return (
        <Badge tone="green">
          <BookOpenCheck className="size-3" /> Answered from your materials
        </Badge>
      );
    case "partial":
      return (
        <Badge tone="amber">
          <BookOpenCheck className="size-3" /> Partly covered by your materials
        </Badge>
      );
    case "insufficient":
      return (
        <Badge tone="slate">
          <SearchX className="size-3" /> Not found in your materials
        </Badge>
      );
    case "general":
      return (
        <Badge tone="indigo">
          <Globe2 className="size-3" /> General knowledge — not from your materials
        </Badge>
      );
    default:
      return null;
  }
}

/**
 * The opening words of the cited passage — the text the source viewer highlights — so two sources on the same page are
 * told apart at a glance. Leading page furniture is skipped: a repeated running header, a page number and an
 * "available from: <url>" line.
 */
export function passagePreview(snippet: string, sectionTitle: string | null): string {
  const original = snippet.replace(/\s+/g, " ").trim();
  let text = original;
  const header = sectionTitle?.replace(/\s+/g, " ").trim();
  if (header && text.toLowerCase().startsWith(header.toLowerCase())) text = text.slice(header.length).trim();
  text = text.replace(/^\d{1,4}\s+/, "");
  // Only when a new sentence follows the URL — "See the appendix: https://… for details" is content, not furniture.
  text = text.replace(/^[^.!?:]{0,120}:\s*https?:\/\/\S+\s+(?=[A-Z0-9“"(])/, "");
  return text.length >= 20 ? text : original;
}

function SourceRow({ source, onOpen }: { source: TutorSource; onOpen: (s: TutorSource) => void }) {
  const preview = passagePreview(source.snippet, source.sectionTitle);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(source)}
        className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-blue-50"
        title={source.snippet}
      >
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-blue-100 text-[10.5px] font-semibold text-blue-700 group-hover:bg-blue-600 group-hover:text-white">
          {source.ref.replace("S", "")}
        </span>
        <span className="min-w-0 text-[13px] leading-snug">
          <span className="text-muted">Source: </span>
          <span className="font-medium text-ink">{source.materialTitle}</span>
          <span className="text-muted"> — </span>
          <span className="font-medium text-blue-700">{pages(source)}</span>
          {preview && <span className="block truncate text-xs text-muted">“{preview}”</span>}
        </span>
        {source.flagged && <ShieldAlert className="mt-0.5 ml-auto size-3.5 shrink-0 text-amber-500" aria-label="Contains instruction-like text" />}
      </button>
    </li>
  );
}

/** "Source: Machine Learning Notes — Page 14" (PRD §7). Insufficient answers list the closest passages instead. */
export function SourceList({ message, onOpenSource }: { message: TutorMessage; onOpenSource: (s: TutorSource) => void }) {
  const cited = message.sources.filter((s) => s.cited);
  const insufficient = message.grounding?.status === "insufficient";
  const shown = insufficient ? (cited.length ? cited : message.sources.slice(0, 3)) : cited;
  if (shown.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-slate-50/70 p-2">
      <p className="flex items-center gap-1.5 px-2 pt-0.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
        <FileText className="size-3" />
        {insufficient ? "Closest passages (not enough to answer)" : `Sources · ${shown.length}`}
      </p>
      <ul>
        {shown.map((source) => (
          <SourceRow key={source.ref} source={source} onOpen={onOpenSource} />
        ))}
      </ul>
    </div>
  );
}

function FeedbackButtons({ projectId, message }: { projectId: string; message: TutorMessage }) {
  const feedback = useTutorFeedback(projectId);
  const [rating, setRating] = useState(message.feedback?.rating ?? null);

  async function rate(value: "up" | "down", reason?: string) {
    const previous = rating;
    setRating(value);
    try {
      await feedback.mutateAsync({ messageId: message.id, rating: value, reason });
      toast.success(value === "up" ? "Thanks — glad that helped!" : "Thanks for the feedback. Zoya's answer will be reviewed.");
    } catch (err) {
      setRating(previous);
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => rate("up", "helpful")}
        className={cn("rounded-lg p-1.5 transition-colors hover:bg-slate-100", rating === "up" ? "text-emerald-600" : "text-muted hover:text-ink")}
        aria-label="Helpful"
        aria-pressed={rating === "up"}
        title="Helpful"
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <Menu
        align="start"
        trigger={
          <button
            type="button"
            className={cn("rounded-lg p-1.5 transition-colors hover:bg-slate-100", rating === "down" ? "text-amber-600" : "text-muted hover:text-ink")}
            aria-label="Not helpful"
            aria-pressed={rating === "down"}
            title="Not helpful"
          >
            <ThumbsDown className="size-3.5" />
          </button>
        }
      >
        <MenuLabel>What went wrong?</MenuLabel>
        {[
          ["incorrect", "It's incorrect"],
          ["not_grounded", "Not based on my materials"],
          ["wrong_citation", "Wrong source or page"],
          ["unclear", "Hard to understand"],
          ["too_long", "Too long"],
          ["other", "Something else"],
        ].map(([reason, label]) => (
          <MenuItem key={reason} onSelect={() => rate("down", reason)}>
            {label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text.replace(/\s?\[S\d{1,2}\]/g, "")).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-lg p-1.5 text-muted transition-colors hover:bg-slate-100 hover:text-ink"
      aria-label="Copy answer"
      title="Copy"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function FollowUps({ suggestions, onSelect, disabled }: { suggestions: string[]; onSelect: (s: string) => void; disabled?: boolean }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(s)}
          className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-left text-[13px] text-blue-700 shadow-card transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function AssistantMessage({
  message,
  projectId,
  isLast,
  busy,
  onOpenSource,
  onFollowUp,
  onGeneralKnowledge,
  onRetry,
}: {
  message: TutorMessage;
  projectId: string;
  isLast: boolean;
  busy: boolean;
  onOpenSource: (s: TutorSource) => void;
  onFollowUp: (text: string) => void;
  onGeneralKnowledge?: () => void;
  onRetry?: () => void;
}) {
  const insufficient = message.grounding?.status === "insufficient";
  const toolSummary = message.toolCalls.filter((t) => t.ok).map((t) => t.summary);

  return (
    <div className="flex gap-3">
      <ZoyaAvatar size={34} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-3">
        {message.status === "streaming" ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Zoya is still answering…
          </p>
        ) : (
          message.content && <AnswerMarkdown content={message.content} sources={message.sources} onOpenSource={onOpenSource} />
        )}

        {message.status === "error" && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{message.error?.message ?? "Zoya couldn't finish this answer."}</span>
            {onRetry && (
              <Button size="sm" variant="secondary" onClick={onRetry} disabled={busy}>
                <RotateCcw className="size-3.5" /> Try again
              </Button>
            )}
          </div>
        )}
        {message.status === "stopped" && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="slate">Stopped</Badge>
            {onRetry && (
              <button type="button" onClick={onRetry} disabled={busy} className="font-medium text-blue-700 hover:underline disabled:opacity-50">
                Answer again
              </button>
            )}
          </div>
        )}

        {message.status !== "streaming" && message.status !== "error" && (
          <>
            {(message.grounding?.status && message.grounding.status !== "conversational") || toolSummary.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <GroundingBadge grounding={message.grounding} />
                {toolSummary.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted" title={toolSummary.join(" · ")}>
                    <Wrench className="size-3" /> {toolSummary[0]}
                    {toolSummary.length > 1 ? ` +${toolSummary.length - 1}` : ""}
                  </span>
                )}
              </div>
            ) : null}

            <SourceList message={message} onOpenSource={onOpenSource} />

            {insufficient && onGeneralKnowledge && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                <p className="min-w-0 flex-1 basis-60 text-[13px] text-indigo-950">
                  Zoya only answers from your materials so you can check every claim. Want a general explanation anyway?
                </p>
                <Button size="sm" variant="secondary" onClick={onGeneralKnowledge} disabled={busy}>
                  <Globe2 className="size-3.5" /> Answer from general knowledge
                </Button>
                <Link href={`/projects/${projectId}/materials`} className={buttonClasses("ghost", "sm")}>
                  <Upload className="size-3.5" /> Add material
                </Link>
              </div>
            )}

            {isLast && <FollowUps suggestions={message.suggestions} onSelect={onFollowUp} disabled={busy} />}

            {message.content && (
              <div className="-ml-1.5 flex items-center gap-0.5">
                <CopyButton text={message.content} />
                <FeedbackButtons projectId={projectId} message={message} />
                {message.metrics?.latencyMs != null && (
                  <span className="ml-2 text-[11px] text-slate-400" title={message.metrics.model ?? undefined}>
                    {(message.metrics.latencyMs / 1000).toFixed(1)} s
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export interface LiveTurnView {
  stage: string | null;
  label: string;
  content: string;
  sources: TutorSource[];
  tools: Array<{ name: string; status: "started" | "finished" | "failed"; summary: string }>;
  error: string | null;
}

/** The answer while it streams: what Zoya is doing (understanding → searching → writing) and the text so far. */
export function LiveAssistant({
  turn,
  onOpenSource,
  onRetry,
}: {
  turn: LiveTurnView;
  onOpenSource: (s: TutorSource) => void;
  onRetry: () => void;
}) {
  const writing = turn.content.length > 0;
  return (
    <div className="flex gap-3" aria-live="polite" aria-busy={!turn.error}>
      <ZoyaAvatar size={34} className="mt-0.5" state={turn.error ? "idle" : writing ? "speaking" : "thinking"} />
      <div className="min-w-0 flex-1 space-y-3">
        {!writing && !turn.error && (
          <div className="space-y-2 pt-1">
            <p className="flex items-center gap-2 text-sm font-medium text-blue-700">
              <span className="flex gap-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 animate-bounce rounded-full bg-blue-500" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
              {turn.label}…
            </p>
            {turn.sources.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <FileText className="size-3.5" />
                Found {turn.sources.length} relevant passage{turn.sources.length === 1 ? "" : "s"} in{" "}
                {[...new Set(turn.sources.map((s) => s.materialTitle))].slice(0, 2).join(", ")}
              </p>
            )}
            {turn.tools.map((tool, i) => (
              <p key={`${tool.name}-${i}`} className="flex items-center gap-1.5 text-xs text-muted">
                {tool.status === "started" ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}
                {tool.summary}
              </p>
            ))}
          </div>
        )}
        {writing && <AnswerMarkdown content={turn.content} sources={turn.sources} onOpenSource={onOpenSource} streaming />}
        {turn.error && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{turn.error}</span>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              <RotateCcw className="size-3.5" /> Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
