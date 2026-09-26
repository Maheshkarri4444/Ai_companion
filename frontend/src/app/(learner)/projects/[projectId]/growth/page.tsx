"use client";

import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleDashed, Lightbulb, Minus, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { LineChart, shortDate, Sparkline } from "@/components/charts/line-chart";
import { WindowTabs } from "@/components/charts/window-tabs";
import { RecommendationList } from "@/components/learning/recommendation-list";
import { MasteryBar, pct } from "@/components/quiz/mastery";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { StatCard } from "@/components/ui/misc";
import { timeAgo } from "@/lib/format";
import { useProjectGrowth, useRecommendations } from "@/lib/queries";
import type { AnalyticsRange, ConceptGrowth, GrowthStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS: Record<GrowthStatus, { label: string; icon: typeof TrendingUp; chip: string; description: string }> = {
  attention: { label: "Requiring attention", icon: AlertTriangle, chip: "bg-rose-50 text-rose-700 ring-rose-600/15", description: "Low, falling, or recently missed" },
  improving: { label: "Improving", icon: ArrowUpRight, chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/15", description: "Up 8 points or more" },
  stable: { label: "Stable", icon: Minus, chip: "bg-slate-100 text-slate-700 ring-slate-500/15", description: "Holding steady" },
  not_assessed: { label: "Not assessed yet", icon: CircleDashed, chip: "bg-slate-50 text-slate-500 ring-slate-400/15", description: "No quiz answers yet" },
};

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted">—</span>;
  const points = Math.round(value * 100);
  const Icon = points > 0 ? ArrowUpRight : points < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums", points > 0 ? "text-emerald-600" : points < 0 ? "text-rose-600" : "text-muted")}>
      <Icon className="size-3.5" />
      {points > 0 ? "+" : ""}
      {points} pts
    </span>
  );
}

function ConceptRow({ concept, projectId }: { concept: ConceptGrowth; projectId: string }) {
  return (
    <li className="grid gap-3 py-3.5 sm:grid-cols-[minmax(0,1fr)_96px_190px] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-ink">{concept.name}</p>
          <span className="text-xs text-muted">
            {concept.evidenceCount} answer{concept.evidenceCount === 1 ? "" : "s"}
            {concept.lastPracticedAt ? ` · practised ${timeAgo(concept.lastPracticedAt)}` : ""}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <MasteryBar value={concept.mastery} before={concept.baseline} className="max-w-56" />
          <span className="w-10 text-sm font-semibold text-ink tabular-nums">{pct(concept.mastery)}</span>
          <Delta value={concept.delta} />
        </div>
        {concept.reasonText.length > 0 && <p className="mt-1.5 text-xs text-rose-700">{concept.reasonText.join(" · ")}</p>}
        {concept.weakLevel && concept.strongLevel && (
          <p className="mt-1 text-xs text-muted">
            {concept.strongLevel.level} {pct(concept.strongLevel.accuracy)} · {concept.weakLevel.level} {pct(concept.weakLevel.accuracy)}
          </p>
        )}
      </div>
      <Sparkline values={concept.series.map((p) => p.mastery)} className="hidden sm:block" />
      <div className="flex flex-wrap gap-1.5 sm:justify-end">
        <Link href={`/projects/${projectId}/quiz?focus=${concept.conceptId}`} className={buttonClasses("secondary", "sm")}>
          Practise
        </Link>
        <Link href={`/projects/${projectId}/tutor?ask=${encodeURIComponent(`Explain ${concept.name}`)}`} className={buttonClasses("ghost", "sm")}>
          Ask Zoya
        </Link>
      </div>
    </li>
  );
}

export default function GrowthPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [window, setWindow] = useState<AnalyticsRange>("30d");
  const { data, isLoading, error, refetch, isPlaceholderData } = useProjectGrowth(projectId, window);
  const recommendations = useRecommendations(projectId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const groups = (["attention", "improving", "stable", "not_assessed"] as const).map((status) => ({
    status,
    items: data.concepts.filter((c) => c.status === status).sort((a, b) => b.severity - a.severity || (b.delta ?? 0) - (a.delta ?? 0)),
  }));
  const s = data.summary;

  if (s.totalConcepts === 0) {
    return (
      <EmptyState
        icon={<TrendingUp />}
        title="Growth appears once your materials are processed"
        description="Upload a PDF, then take a quiz — every answer updates your concept mastery, and this page shows how it changes over time."
        action={
          <Link href={`/projects/${projectId}/materials`} className={buttonClasses("primary", "sm")}>
            Go to Materials
          </Link>
        }
      />
    );
  }

  return (
    <div className={cn("space-y-6 transition-opacity", isPlaceholderData && "opacity-60")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Growth analysis</h2>
          <p className="text-sm text-muted">How your estimated mastery changed — and what needs attention next.</p>
        </div>
        <WindowTabs value={window} onChange={setWindow} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Overall mastery"
          value={pct(s.overallMastery)}
          icon={<TrendingUp />}
          hint={s.overallChange !== null ? `${s.overallChange >= 0 ? "+" : ""}${Math.round(s.overallChange * 100)} pts in ${data.window.days} days` : `${s.assessedConcepts} of ${s.totalConcepts} concepts assessed`}
        />
        <StatCard label="Improving" value={s.counts.improving} icon={<ArrowUpRight />} tone="emerald" hint="Up 8+ points" />
        <StatCard label="Requiring attention" value={s.counts.attention} icon={<AlertTriangle />} tone="amber" hint="Low, falling or missed" />
        <StatCard label="Answers in period" value={s.answersInWindow} icon={<CircleDashed />} tone="violet" hint={`${Math.round(s.coverage * 100)}% of concepts assessed`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardBody>
            <LineChart
              label="Overall mastery over time"
              data={data.progressSeries.map((p) => ({ key: p.date, label: shortDate(p.date), value: p.overallMastery, detail: `${p.assessed} concepts assessed` }))}
              emptyText="Take a quiz — your progress line starts with your first answers."
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Insights" icon={<Lightbulb className="size-4" />} />
          <CardBody className="pt-1">
            {data.insights.length === 0 ? (
              <p className="text-sm text-muted">Insights appear after a few quiz answers.</p>
            ) : (
              <ul className="space-y-2.5">
                {data.insights.map((insight, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-soft">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        insight.kind === "improving" ? "bg-emerald-500" : insight.kind === "attention" ? "bg-rose-500" : insight.kind === "gap" ? "bg-amber-400" : "bg-blue-500",
                      )}
                    />
                    {insight.text}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="What to do next" description="Recommendations from your mastery, recent mistakes and activity" icon={<Lightbulb className="size-4" />} />
        <CardBody>
          {recommendations.data ? <RecommendationList projectId={projectId} items={recommendations.data.items} /> : <Skeleton className="h-24" />}
        </CardBody>
      </Card>

      {groups
        .filter((g) => g.items.length > 0)
        .map((group) => {
          const meta = STATUS[group.status];
          const Icon = meta.icon;
          return (
            <Card key={group.status}>
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <p className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
                  <span className={cn("inline-flex size-7 items-center justify-center rounded-lg ring-1 ring-inset", meta.chip)}>
                    <Icon className="size-4" />
                  </span>
                  {meta.label}
                  <span className="text-sm font-normal text-muted">· {group.items.length}</span>
                </p>
                <span className="hidden text-xs text-muted sm:block">{meta.description}</span>
              </div>
              <ul className="divide-y divide-line px-5">
                {group.items.map((concept) => (
                  <ConceptRow key={concept.conceptId} concept={concept} projectId={projectId} />
                ))}
              </ul>
            </Card>
          );
        })}
    </div>
  );
}
