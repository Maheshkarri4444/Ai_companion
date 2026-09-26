"use client";

import { ArrowRight, BookOpen, Lightbulb, MessageSquare, PlayCircle, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { useRecommendationAction } from "@/lib/queries";
import type { QuizSession, Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<Recommendation["action"]["type"], typeof Sparkles> = {
  start_quiz: PlayCircle,
  resume_quiz: RotateCcw,
  ask_tutor: MessageSquare,
  review_material: BookOpen,
  upload_material: Upload,
};

/** Performs a recommendation's action (quiz, Tutor, materials) and records that the learner followed it. */
export function useFollowRecommendation(projectId: string) {
  const router = useRouter();
  const { act } = useRecommendationAction(projectId);
  const [busy, setBusy] = useState<string | null>(null);

  async function follow(rec: Recommendation) {
    setBusy(rec.id);
    try {
      const base = `/projects/${rec.projectId}`;
      let href = base;
      const params = rec.action.params;
      if (rec.action.type === "start_quiz") {
        const { session } = await api.post<{ session: QuizSession }>(`${base}/quizzes`, {
          mode: params.mode ?? "adaptive",
          targetCount: params.targetCount ?? 5,
          questionTypes: params.questionTypes ?? "mixed",
          conceptIds: params.conceptIds ?? [],
        });
        href = `${base}/quiz/${session.id}`;
      } else if (rec.action.type === "resume_quiz") href = `${base}/quiz/${String(params.sessionId)}`;
      else if (rec.action.type === "ask_tutor") href = `${base}/tutor?ask=${encodeURIComponent(String(params.prompt ?? ""))}`;
      else if (rec.action.type === "upload_material" || rec.action.type === "review_material") href = `${base}/materials`;
      void act.mutateAsync(rec.id).catch(() => undefined);
      router.push(href);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  return { follow, busy };
}

export function RecommendationList({
  projectId,
  items,
  compact = false,
}: {
  projectId: string;
  items: Recommendation[];
  compact?: boolean;
}) {
  const { follow, busy } = useFollowRecommendation(projectId);
  const { dismiss } = useRecommendationAction(projectId);

  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-5 text-sm text-muted">
        <Lightbulb className="size-4 text-blue-500" /> No recommendations right now — keep learning and new ones will appear.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((rec, i) => {
        const Icon = ICONS[rec.action.type] ?? Sparkles;
        return (
          <li
            key={rec.id}
            className={cn(
              "group relative rounded-xl border p-4 transition-colors",
              i === 0 ? "border-blue-200 bg-linear-to-br from-blue-50/80 to-white" : "border-line bg-white hover:border-blue-200",
            )}
          >
            <div className="flex items-start gap-3">
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", i === 0 ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-600")}>
                <Icon className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                {i === 0 && <p className="text-[11px] font-semibold tracking-wide text-blue-700 uppercase">Recommended next</p>}
                <p className="font-medium text-ink">{rec.title}</p>
                {!compact && <p className="mt-1 text-sm leading-relaxed text-ink-soft">{rec.rationale}</p>}
                {!compact && rec.review && (
                  <p className="mt-1.5 text-xs text-muted">
                    Review first:{" "}
                    {rec.review.materialId && rec.review.page ? (
                      <a
                        href={`/api/projects/${projectId}/materials/${rec.review.materialId}/file#page=${rec.review.page}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {rec.review.materialTitle} {rec.review.pages}
                      </a>
                    ) : (
                      <span className="font-medium text-ink-soft">
                        {rec.review.materialTitle} {rec.review.pages}
                      </span>
                    )}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant={i === 0 ? "primary" : "secondary"} onClick={() => follow(rec)} loading={busy === rec.id}>
                    {rec.action.label} <ArrowRight className="size-3.5" />
                  </Button>
                  {rec.source === "ai" && <span className="text-[11px] text-muted">Phrased by AI from your learning data</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismiss.mutate(rec.id, { onError: (err) => toast.error(errorMessage(err)) })}
                className="rounded-lg p-1.5 text-slate-400 opacity-100 transition hover:bg-slate-100 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100"
                aria-label={`Dismiss: ${rec.title}`}
                title="Not now"
              >
                <X className="size-4" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
