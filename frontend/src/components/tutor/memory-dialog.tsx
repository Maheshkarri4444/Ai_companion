"use client";

import { Brain, Compass, Flag, Heart, Lightbulb, Lock, Repeat, Sparkles, StickyNote, Target, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useForgetMemory, useTutorMemory } from "@/lib/queries";
import type { LearningKind } from "@/lib/types";

const KIND: Record<LearningKind, { label: string; icon: typeof Brain; tone: string }> = {
  goal: { label: "Goal", icon: Target, tone: "bg-blue-50 text-blue-600" },
  preference: { label: "Preference", icon: Heart, tone: "bg-pink-50 text-pink-600" },
  strength: { label: "Strength", icon: Sparkles, tone: "bg-emerald-50 text-emerald-600" },
  weakness: { label: "Needs practice", icon: TriangleAlert, tone: "bg-amber-50 text-amber-600" },
  misconception: { label: "Misconception", icon: Lightbulb, tone: "bg-orange-50 text-orange-600" },
  mistake_pattern: { label: "Repeated mistake", icon: Repeat, tone: "bg-red-50 text-red-600" },
  interest: { label: "Interest", icon: Compass, tone: "bg-violet-50 text-violet-600" },
  milestone: { label: "Milestone", icon: Flag, tone: "bg-cyan-50 text-cyan-600" },
  note: { label: "Note", icon: StickyNote, tone: "bg-slate-100 text-slate-600" },
};

/**
 * Transparency and control over persistent learning context (PRD §11): the learner sees exactly what is
 * remembered, where it applies, and can delete any of it.
 */
export function MemoryDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data, isLoading, error, refetch } = useTutorMemory(projectId, open);
  const forget = useForgetMemory(projectId);

  async function onForget(id: string) {
    try {
      await forget.mutateAsync(id);
      toast.success("Zoya forgot that");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="What Zoya remembers"
      description="Useful things about how you learn, kept across sessions and used only when relevant. Nothing here leaves this Project unless marked “All projects”."
      size="lg"
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          compact
          icon={<Brain />}
          title="Nothing remembered yet"
          description="As you learn, Zoya notes your goals, preferences and the topics you find tricky — so the next session picks up where you left off."
        />
      ) : (
        <ul className="divide-y divide-line">
          {data.map((item) => {
            const meta = KIND[item.kind] ?? KIND.note;
            const Icon = meta.icon;
            return (
              <li key={item.id} className="flex items-start gap-3 py-3">
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{item.content}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Badge tone="slate">{meta.label}</Badge>
                    {item.scope === "user" && (
                      <Badge tone="indigo">
                        <Lock className="size-3" /> All projects
                      </Badge>
                    )}
                    {item.evidenceCount > 1 && <span>Observed {item.evidenceCount}×</span>}
                    <span>· {timeAgo(item.lastObservedAt)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onForget(item.id)}
                  disabled={forget.isPending}
                  className="rounded-lg p-2 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
                  aria-label={`Forget: ${item.content}`}
                  title="Forget this"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
