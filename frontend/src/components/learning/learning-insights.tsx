"use client";

import { AlertTriangle, LineChart } from "lucide-react";
import Link from "next/link";
import { MasteryBar, pct } from "@/components/quiz/mastery";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { AttentionArea, LearningProgress } from "@/lib/types";

/**
 * "How am I doing?" — overall mastery (with its coverage) and the areas requiring attention across several Projects.
 * Used by the Home dashboard (recent Projects) and Space dashboards (the Space's Projects).
 */
export function LearningInsights({
  progress,
  attention,
  showProject = true,
}: {
  progress: LearningProgress | null;
  attention: AttentionArea[];
  showProject?: boolean;
}) {
  const assessed = progress && progress.assessedConcepts > 0;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Your progress"
        icon={<LineChart className="size-4" />}
        action={
          <Link href="/analytics" className="text-sm font-medium text-blue-700 hover:text-blue-600">
            Analytics
          </Link>
        }
      />
      <CardBody className="space-y-5">
        {assessed ? (
          <div>
            <div className="flex items-end justify-between gap-3">
              <p className="font-display text-3xl font-semibold text-ink tabular-nums">{pct(progress.overallMastery)}</p>
              <p className="text-right text-xs text-muted">
                overall mastery
                <br />
                {progress.assessedConcepts} of {progress.totalConcepts} concepts assessed
              </p>
            </div>
            <MasteryBar value={progress.overallMastery} className="mt-2" />
            <p className="mt-2 text-xs text-muted">
              {progress.answersThisWeek} answers this week · {progress.improving} improving · {progress.strong} strong
            </p>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong bg-canvas/60 p-4 text-sm leading-relaxed text-muted">
            Take a quiz in any Project — your overall mastery and the areas needing attention appear here.
          </p>
        )}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            <AlertTriangle className="size-3.5 text-rose-500" /> Areas requiring attention
          </p>
          {attention.length === 0 ? (
            <p className="text-sm text-muted">{assessed ? "Nothing needs attention right now. Nice work!" : "None yet."}</p>
          ) : (
            <ul className="space-y-2.5">
              {attention.map((a) => (
                <li key={`${a.projectId}-${a.conceptId}`}>
                  <Link href={`/projects/${a.projectId}/growth`} className="group block rounded-lg p-1.5 -m-1.5 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink group-hover:text-blue-700">{a.name}</span>
                      <span className="text-xs font-semibold text-rose-600 tabular-nums">{pct(a.mastery)}</span>
                    </div>
                    <p className="truncate text-xs text-muted">{showProject ? `${a.projectName} · ${a.reasons[0] ?? ""}` : a.reasons.join(" · ")}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
