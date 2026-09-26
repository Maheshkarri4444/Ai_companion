"use client";

import { Activity, ArrowDownRight, ArrowUpRight, Bot, CalendarCheck, CheckCircle2, Clock, Flame, MessageSquare, TrendingUp } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { bucketLabel, ColumnChart } from "@/components/admin/column-chart";
import { LineChart, shortDate } from "@/components/charts/line-chart";
import { BandBar, ScoreBars } from "@/components/charts/score-bars";
import { WindowTabs } from "@/components/charts/window-tabs";
import { pct } from "@/components/quiz/mastery";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { StatCard } from "@/components/ui/misc";
import { formatNumber } from "@/lib/format";
import { useProjectAnalytics } from "@/lib/queries";
import type { AnalyticsRange } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = { mcq: "Multiple choice", open: "Written" };
const LEVEL_LABEL: Record<string, string> = { recall: "Recall", understand: "Understanding", apply: "Application", analyze: "Analysis" };

export default function ProjectAnalyticsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const { data, isLoading, error, refetch, isPlaceholderData } = useProjectAnalytics(projectId, range);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const k = data.kpis;

  return (
    <div className={cn("space-y-6 transition-opacity", isPlaceholderData && "opacity-60")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Project analytics</h2>
          <p className="text-sm text-muted">Learning activity, assessment performance, mastery, concept trends and AI activity.</p>
        </div>
        <WindowTabs value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Active days" value={`${k.activeDays}/${data.range.days}`} icon={<CalendarCheck />} hint={`Streak ${k.streak.current} · best ${k.streak.longest}`} />
        <StatCard label="Questions answered" value={formatNumber(k.answered)} icon={<CheckCircle2 />} tone="emerald" hint={k.accuracy === null ? "No answers yet" : `${pct(k.accuracy)} correct`} />
        <StatCard label="Asked Zoya" value={formatNumber(k.tutorQuestions)} icon={<MessageSquare />} tone="violet" hint={data.ai.groundedRate === null ? "No answers yet" : `${pct(data.ai.groundedRate)} from your materials`} />
        <StatCard
          label="Overall mastery"
          value={pct(k.overallMastery)}
          icon={<TrendingUp />}
          tone="indigo"
          hint={k.overallChange === null ? `${Math.round(k.coverage * 100)}% of concepts assessed` : `${k.overallChange >= 0 ? "+" : ""}${Math.round(k.overallChange * 100)} pts in period`}
        />
        <StatCard label="Quiz time" value={`${formatNumber(k.studyMinutes)} min`} icon={<Clock />} tone="amber" hint={`${k.quizzesCompleted} quizzes completed`} />
      </div>

      <Card className="grid gap-6 p-5 lg:grid-cols-2">
        <ColumnChart
          label="Learning activity per day"
          data={data.activity.series.map((d) => ({
            key: d.date,
            label: bucketLabel(d.date),
            value: d.total,
            detail: `${d.answers} answers · ${d.tutor} Tutor · ${d.materials} material`,
          }))}
        />
        <LineChart
          label="Average quiz score per day"
          data={data.assessment.series.map((d) => ({ key: d.date, label: shortDate(d.date), value: d.avgScore, detail: `${d.answered} answers` }))}
          tone="emerald"
          emptyText="No quiz answers in this period."
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Assessment performance" description="Average score by question type" icon={<Activity className="size-4" />} />
          <CardBody className="space-y-5">
            <ScoreBars rows={data.assessment.byType.map((r) => ({ label: TYPE_LABEL[r.key] ?? r.key, value: r.avgScore, count: r.answered }))} />
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">By difficulty</p>
              <ScoreBars rows={[1, 2, 3, 4, 5].map((d) => {
                const row = data.assessment.byDifficulty.find((r) => r.key === String(d));
                return { label: `Level ${d}`, value: row?.avgScore ?? null, count: row?.answered ?? 0 };
              })} />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Mastery" description={`${data.mastery.summary.assessedConcepts} of ${data.mastery.summary.totalConcepts} concepts assessed`} icon={<TrendingUp className="size-4" />} />
          <CardBody className="space-y-5">
            <BandBar bands={data.mastery.bands} />
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">By cognitive level</p>
              <ScoreBars rows={data.assessment.byLevel.map((r) => ({ label: LEVEL_LABEL[r.key] ?? r.key, value: r.avgScore, count: r.answered }))} />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Concept trends" description="Largest changes in this period" icon={<Flame className="size-4" />} />
          <CardBody>
            {data.conceptTrends.improving.length === 0 && data.conceptTrends.declining.length === 0 ? (
              <p className="text-sm text-muted">Trends appear once concepts have been assessed more than once.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {[...data.conceptTrends.improving, ...data.conceptTrends.declining].map((c) => (
                  <li key={c.conceptId} className="flex items-start gap-2">
                    {(c.delta ?? 0) >= 0 ? <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <ArrowDownRight className="mt-0.5 size-4 shrink-0 text-rose-600" />}
                    <span className="min-w-0 flex-1 leading-snug text-ink-soft">{c.name}</span>
                    <span className="text-muted tabular-nums">{pct(c.mastery)}</span>
                    <span className={cn("w-14 text-right text-xs font-semibold tabular-nums", (c.delta ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {(c.delta ?? 0) >= 0 ? "+" : ""}
                      {Math.round((c.delta ?? 0) * 100)} pts
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardBody>
            <LineChart
              label="Overall mastery over time"
              data={data.mastery.progressSeries.map((p) => ({ key: p.date, label: shortDate(p.date), value: p.overallMastery, detail: `${p.assessed} concepts assessed` }))}
              emptyText="Mastery appears after your first quiz answers."
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="AI activity" description="Your Tutor usage in this Project" icon={<Bot className="size-4" />} />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {(
                [
                  ["Questions to Zoya", formatNumber(data.ai.tutorQuestions)],
                  ["Conversations", formatNumber(data.ai.conversations)],
                  ["Answered from materials", data.ai.groundedRate === null ? "—" : pct(data.ai.groundedRate)],
                  ["AI calls", formatNumber(data.ai.calls)],
                  ["Tokens", formatNumber(data.ai.tokens)],
                  ["Estimated cost", `$${data.ai.costUsd.toFixed(4)}`],
                ] as Array<[string, string]>
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold text-ink tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
