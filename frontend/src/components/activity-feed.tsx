import {
  AlertTriangle,
  CircleCheck,
  CircleX,
  FileCheck2,
  FilePlus2,
  FileMinus2,
  FilePen,
  MessageSquareQuote,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  FolderPlus,
  FolderPen,
  FolderMinus,
  Layers,
  Lightbulb,
  ListChecks,
  LogIn,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { timeAgo, formatBytes } from "@/lib/format";
import type { ActivityEvent, ActivityType } from "@/lib/types";
import { cn } from "@/lib/utils";

const str = (value: unknown) => (typeof value === "string" ? value : "");

interface Described {
  Icon: LucideIcon;
  tone: string;
  text: ReactNode;
}

/** Turns an event + its metadata snapshot into a human sentence (history stays readable after deletes). */
export function describeActivity(event: Pick<ActivityEvent, "type" | "metadata">): Described {
  const m = event.metadata ?? {};
  const q = (value: unknown) => <strong className="font-medium text-ink">{str(value) || "untitled"}</strong>;
  switch (event.type) {
    case "user.registered":
      return { Icon: UserPlus, tone: "bg-emerald-50 text-emerald-600", text: <>Joined AI Study Companion</> };
    case "user.logged_in":
      return { Icon: LogIn, tone: "bg-slate-100 text-slate-500", text: <>Signed in</> };
    case "space.created":
      return { Icon: Layers, tone: "bg-blue-50 text-blue-600", text: <>Created space {q(m.spaceName)}</> };
    case "space.updated":
      return { Icon: Layers, tone: "bg-slate-100 text-slate-600", text: <>Updated space {q(m.spaceName)}</> };
    case "space.deleted":
      return { Icon: Layers, tone: "bg-red-50 text-red-500", text: <>Deleted space {q(m.spaceName)}</> };
    case "project.created":
      return {
        Icon: FolderPlus,
        tone: "bg-indigo-50 text-indigo-600",
        text: (
          <>
            Started project {q(m.projectName)}
            {str(m.spaceName) && <> in {q(m.spaceName)}</>}
          </>
        ),
      };
    case "project.updated":
      return { Icon: FolderPen, tone: "bg-slate-100 text-slate-600", text: <>Updated project {q(m.projectName)}</> };
    case "project.deleted":
      return { Icon: FolderMinus, tone: "bg-red-50 text-red-500", text: <>Deleted project {q(m.projectName)}</> };
    case "material.uploaded":
      return {
        Icon: FilePlus2,
        tone: "bg-cyan-50 text-cyan-600",
        text: (
          <>
            Uploaded {q(m.materialTitle)} to {q(m.projectName)}
            {typeof m.sizeBytes === "number" && <span className="text-muted"> · {formatBytes(m.sizeBytes)}</span>}
          </>
        ),
      };
    case "material.updated":
      return { Icon: FilePen, tone: "bg-slate-100 text-slate-600", text: <>Renamed material to {q(m.materialTitle)}</> };
    case "material.deleted":
      return { Icon: FileMinus2, tone: "bg-red-50 text-red-500", text: <>Removed {q(m.materialTitle)} from {q(m.projectName)}</> };
    case "material.processed":
      return {
        Icon: FileCheck2,
        tone: "bg-emerald-50 text-emerald-600",
        text: (
          <>
            {q(m.materialTitle)} is ready
            {typeof m.conceptCount === "number" && (
              <span className="text-muted">
                {" "}
                · {m.pageCount as number} pages · {m.conceptCount} concepts
              </span>
            )}
          </>
        ),
      };
    case "material.failed":
      return { Icon: AlertTriangle, tone: "bg-red-50 text-red-500", text: <>Processing failed for {q(m.materialTitle)}</> };
    case "material.reprocessed":
      return { Icon: RefreshCw, tone: "bg-amber-50 text-amber-600", text: <>Retried processing {q(m.materialTitle)}</> };
    case "tutor.answered":
      return {
        Icon: MessageSquareQuote,
        tone: "bg-violet-50 text-violet-600",
        text: (
          <>
            Asked Zoya <span className="text-ink">“{str(m.question) || "a question"}”</span>
            {m.grounding === "grounded" && <span className="text-muted"> · answered from materials</span>}
            {m.grounding === "insufficient" && <span className="text-muted"> · not in materials</span>}
          </>
        ),
      };
    case "tutor.feedback":
      return {
        Icon: m.rating === "down" ? ThumbsDown : ThumbsUp,
        tone: m.rating === "down" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600",
        text: <>Rated an answer from Zoya {m.rating === "down" ? "as unhelpful" : "as helpful"}</>,
      };
    case "quiz.started": {
      const focus = Array.isArray(m.focus) ? (m.focus as unknown[]).filter((f): f is string => typeof f === "string") : [];
      return {
        Icon: ListChecks,
        tone: "bg-blue-50 text-blue-600",
        text: (
          <>
            Started a {m.mode === "focused" ? "focused" : m.mode === "review" ? "review" : "adaptive"} quiz in {q(m.projectName)}
            {focus.length > 0 && <span className="text-muted"> · {focus.slice(0, 3).join(", ")}</span>}
          </>
        ),
      };
    }
    case "quiz.question_answered":
      return {
        Icon: m.isCorrect ? CircleCheck : CircleX,
        tone: m.isCorrect ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600",
        text: (
          <>
            Answered a question on {q(Array.isArray(m.conceptNames) ? m.conceptNames[0] : "")}
            <span className="text-muted"> · {m.isCorrect ? "correct" : "incorrect"}</span>
          </>
        ),
      };
    case "quiz.completed":
      return {
        Icon: Trophy,
        tone: "bg-emerald-50 text-emerald-600",
        text: (
          <>
            Completed a quiz in {q(m.projectName)}
            {typeof m.correct === "number" && typeof m.answered === "number" && (
              <span className="text-muted">
                {" "}
                · {m.correct}/{m.answered} correct
              </span>
            )}
          </>
        ),
      };
    case "mastery.updated": {
      const up = typeof m.after === "number" && typeof m.before === "number" ? m.after >= m.before : true;
      const band = str(m.band).replace(/_/g, " ");
      return {
        Icon: up ? TrendingUp : TrendingDown,
        tone: up ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500",
        text: (
          <>
            {m.before == null ? "First assessment of" : up ? "Mastery rose on" : "Mastery dropped on"} {q(m.conceptName)}
            {band && <span className="text-muted"> · now {band}</span>}
          </>
        ),
      };
    }
    case "recommendation.generated": {
      const count = Array.isArray(m.titles) ? m.titles.length : 0;
      return {
        Icon: Lightbulb,
        tone: "bg-blue-50 text-blue-600",
        text: (
          <>
            {count === 1 ? "1 new recommendation" : `${count} new recommendations`} for {q(m.projectName)}
          </>
        ),
      };
    }
    case "recommendation.completed":
      return {
        Icon: Lightbulb,
        tone: "bg-emerald-50 text-emerald-600",
        text: <>Followed a recommendation: {q(m.title)}</>,
      };
    case "recommendation.dismissed":
      return {
        Icon: X,
        tone: "bg-slate-100 text-slate-500",
        text: <>Dismissed a recommendation: {q(m.title)}</>,
      };
    default:
      return { Icon: Layers, tone: "bg-slate-100 text-slate-500", text: <>{(event.type as string).replace(/[._]/g, " ")}</> };
  }
}

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  "user.registered": "Account created",
  "user.logged_in": "Signed in",
  "space.created": "Space created",
  "space.updated": "Space updated",
  "space.deleted": "Space deleted",
  "project.created": "Project created",
  "project.updated": "Project updated",
  "project.deleted": "Project deleted",
  "material.uploaded": "Material uploaded",
  "material.updated": "Material renamed",
  "material.deleted": "Material deleted",
  "material.processed": "Material processed",
  "material.failed": "Material failed",
  "material.reprocessed": "Material retried",
  "tutor.answered": "Tutor question",
  "tutor.feedback": "Tutor feedback",
  "quiz.started": "Quiz started",
  "quiz.question_answered": "Quiz answer",
  "quiz.completed": "Quiz completed",
  "mastery.updated": "Mastery changed",
  "recommendation.generated": "Recommendations generated",
  "recommendation.completed": "Recommendation followed",
  "recommendation.dismissed": "Recommendation dismissed",
};

function eventHref(event: ActivityEvent): string | undefined {
  if (event.type.endsWith(".deleted")) return undefined;
  if (event.type.startsWith("material.") && event.projectId) return `/projects/${event.projectId}/materials`;
  if ((event.type.startsWith("quiz.") || event.type === "mastery.updated") && event.projectId) {
    const sessionId = str(event.metadata?.sessionId);
    return `/projects/${event.projectId}/quiz${sessionId ? `/${sessionId}` : ""}`;
  }
  if (event.type.startsWith("recommendation.") && event.projectId) return `/projects/${event.projectId}/growth`;
  if (event.type.startsWith("tutor.") && event.projectId) {
    const conversationId = str(event.metadata?.conversationId);
    return `/projects/${event.projectId}/tutor${conversationId ? `?c=${conversationId}` : ""}`;
  }
  if (event.projectId) return `/projects/${event.projectId}`;
  if (event.spaceId) return `/spaces/${event.spaceId}`;
  return undefined;
}

export function ActivityFeed({
  events,
  linkify = true,
  className,
}: {
  events: ActivityEvent[];
  linkify?: boolean;
  className?: string;
}) {
  if (events.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-muted">No activity yet.</p>;
  }
  return (
    <ol className={cn("relative space-y-1", className)}>
      {events.map((event, i) => {
        const { Icon, tone, text } = describeActivity(event);
        const href = linkify ? eventHref(event) : undefined;
        const body = (
          <div className="flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-slate-50">
            <span className="relative flex flex-col items-center">
              <span className={cn("flex size-8 items-center justify-center rounded-lg", tone)}>
                <Icon className="size-4" />
              </span>
              {i < events.length - 1 && <span className="absolute top-9 h-[calc(100%-4px)] w-px bg-line" aria-hidden />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm leading-snug text-ink-soft">{text}</p>
              <p className="mt-0.5 text-xs text-muted">{timeAgo(event.createdAt)}</p>
            </div>
          </div>
        );
        return <li key={event.id}>{href ? <Link href={href}>{body}</Link> : body}</li>;
      })}
    </ol>
  );
}
