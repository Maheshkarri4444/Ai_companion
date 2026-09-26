"use client";

import { BarChart3, CalendarCheck, CheckCircle2, Flame, FolderKanban, Layers, MessageSquare, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { bucketLabel, ColumnChart } from "@/components/admin/column-chart";
import { LineChart, shortDate } from "@/components/charts/line-chart";
import { ScoreBars } from "@/components/charts/score-bars";
import { WindowTabs } from "@/components/charts/window-tabs";
import { MasteryBar, pct } from "@/components/quiz/mastery";
import { SpaceTile } from "@/components/space-visuals";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { formatNumber, timeAgo } from "@/lib/format";
import { useGlobalAnalytics } from "@/lib/queries";
import type { AnalyticsRange } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function GlobalAnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const { data, isLoading, error, refetch, isPlaceholderData } = useGlobalAnalytics(range);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const k = data.kpis;

  return (
    <div className={cn("animate-rise space-y-6 transition-opacity", isPlaceholderData && "opacity-60")}>
      <PageHeader
        title="Analytics"
        description="Your learning across every Space and Project."
        icon={<BarChart3 />}
        actions={<WindowTabs value={range} onChange={setRange} />}
      />

      {k.projects === 0 ? (
        <EmptyState icon={<Layers />} title="No learning data yet" description="Create a Project, add material and start learning — your analytics build up from there." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Overall mastery" value={pct(k.overallMastery)} icon={<TrendingUp />} hint={`${k.assessedConcepts} of ${k.totalConcepts} concepts assessed`} />
            <StatCard label="Learning streak" value={`${k.streak.current} day${k.streak.current === 1 ? "" : "s"}`} icon={<Flame />} tone="amber" hint={`Best ${k.streak.longest} · ${k.activeDays} active days`} />
            <StatCard label="Questions answered" value={formatNumber(k.answered)} icon={<CheckCircle2 />} tone="emerald" hint={k.accuracy === null ? "No answers yet" : `${pct(k.accuracy)} correct`} />
            <StatCard label="Asked Zoya" value={formatNumber(k.tutorQuestions)} icon={<MessageSquare />} tone="violet" hint={`${k.quizzesCompleted} quizzes completed`} />
            <StatCard label="Projects" value={formatNumber(k.projects)} icon={<FolderKanban />} tone="indigo" hint={`${k.spaces} spaces · ${k.readyMaterials} materials`} />
          </div>

          <Card className="grid gap-6 p-5 lg:grid-cols-2">
            <ColumnChart
              label="Learning activity per day"
              data={data.activity.series.map((d) => ({ key: d.date, label: bucketLabel(d.date), value: d.total, detail: `${d.answers} answers · ${d.tutor} Tutor` }))}
            />
            <LineChart
              label="Average quiz score per day"
              tone="emerald"
              data={data.assessment.series.map((d) => ({ key: d.date, label: shortDate(d.date), value: d.avgScore, detail: `${d.answered} answers` }))}
              emptyText="No quiz answers in this period."
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="Progress by Space" description="Mastery weighted by assessed concepts" icon={<Layers className="size-4" />} />
              <CardBody>
                <ul className="divide-y divide-line">
                  {data.perSpace.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-3">
                      <SpaceTile color={s.color} icon={s.icon} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/spaces/${s.id}`} className="font-medium text-ink hover:text-blue-700">
                          {s.name}
                        </Link>
                        <p className="text-xs text-muted">
                          {s.projects} project{s.projects === 1 ? "" : "s"} · {s.assessedConcepts}/{s.totalConcepts} concepts assessed · {s.answered} answers
                        </p>
                      </div>
                      <div className="flex w-44 items-center gap-2">
                        <MasteryBar value={s.overallMastery} />
                        <span className="w-10 text-right text-sm font-semibold text-ink tabular-nums">{pct(s.overallMastery)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Performance" description="Average score by question type" icon={<CalendarCheck className="size-4" />} />
              <CardBody>
                <ScoreBars rows={data.assessment.byType.map((r) => ({ label: r.key === "mcq" ? "Multiple choice" : "Written", value: r.avgScore, count: r.answered }))} />
              </CardBody>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader title="Projects" description="Where each learning journey stands" icon={<FolderKanban className="size-4" />} />
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-y border-line bg-canvas/70 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                    <th className="px-5 py-2.5">Project</th>
                    <th className="px-3 py-2.5">Mastery</th>
                    <th className="px-3 py-2.5 text-right">Coverage</th>
                    <th className="px-3 py-2.5 text-right">Attention</th>
                    <th className="px-3 py-2.5 text-right">Answers</th>
                    <th className="px-3 py-2.5 text-right">Zoya</th>
                    <th className="px-5 py-2.5 text-right">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perProject.map((p) => (
                    <tr key={p.id} className="border-b border-line last:border-0 hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <Link href={`/projects/${p.id}/analytics`} className="font-medium text-ink hover:text-blue-700">
                          {p.name}
                        </Link>
                        {p.space && <span className="block text-xs text-muted">{p.space.name}</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex w-36 items-center gap-2">
                          <MasteryBar value={p.overallMastery} />
                          <span className="w-9 text-right text-xs font-semibold text-ink tabular-nums">{pct(p.overallMastery)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{Math.round(p.coverage * 100)}%</td>
                      <td className={cn("px-3 py-3 text-right tabular-nums", p.needsAttention > 0 && "font-medium text-rose-600")}>{p.needsAttention}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{p.answered}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{p.tutorQuestions}</td>
                      <td className="px-5 py-3 text-right text-xs text-muted">{timeAgo(p.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
