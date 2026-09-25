import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { MaterialStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const tones = {
  blue: "bg-blue-50 text-blue-700 ring-blue-600/15",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/15",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/15",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/15",
  navy: "bg-navy-900 text-blue-100 ring-white/10",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "slate", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const materialStatus: Record<MaterialStatus, { tone: BadgeTone; label: string; icon: ReactNode; hint: string }> = {
  queued: {
    tone: "amber",
    label: "Queued",
    icon: <Clock className="size-3" />,
    hint: "Waiting for background processing",
  },
  processing: {
    tone: "blue",
    label: "Processing",
    icon: <Loader2 className="size-3 animate-spin" />,
    hint: "Extracting text, concepts and search index",
  },
  ready: {
    tone: "green",
    label: "Ready",
    icon: <CheckCircle2 className="size-3" />,
    hint: "Available to the Tutor and quizzes",
  },
  failed: {
    tone: "red",
    label: "Failed",
    icon: <AlertCircle className="size-3" />,
    hint: "Processing failed",
  },
};

export function MaterialStatusBadge({ status, error }: { status: MaterialStatus; error?: string | null }) {
  const meta = materialStatus[status];
  return (
    <span title={error ?? meta.hint}>
      <Badge tone={meta.tone}>
        {meta.icon}
        {meta.label}
      </Badge>
    </span>
  );
}
