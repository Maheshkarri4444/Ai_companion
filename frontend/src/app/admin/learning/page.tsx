"use client";

import { BookOpenCheck, CheckCircle2, Lightbulb, ListChecks, MessageSquare } from "lucide-react";
import { Suspense } from "react";
import { bucketLabel, ColumnChart } from "@/components/admin/column-chart";
import { EmptyRow, Table, Td, Th, useUrlFilters } from "@/components/admin/table";
import { LineChart, shortDate } from "@/components/charts/line-chart";
import { BandBar, ScoreBars } from "@/components/charts/score-bars";
import { WindowTabs } from "@/components/charts/window-tabs";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { formatNumber, pluralize } from "@/lib/format";
import { useAdminLearning } from "@/lib/queries";
import type { AnalyticsRange } from "@/lib/types";
import { cn } from "@/lib/utils";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const TYPE_LABEL: Record<string, string> = { mcq: "Multiple choice", open: "Written" };
const GROUNDING_LABEL: Record<string, string> = {
  grounded: "From materials",
  partial: "Partly from materials",
  insufficient: "Not in materials",
  general: "General knowledge",
  conversational: "Conversational",
};

function LearningView() {
  const [filters, setFilters] = useUrlFilters({ range: "30d" });
  const range = filters.range as AnalyticsRange;
  const { data, error, refetch, isPlaceholderData } = useAdminLearning(range);

  return (
    <div className="animate-rise space-y-6">
      <PageHeader
        title="Learning analytics"
        description="How learners perform across the platform: quizzes, answers, mastery, recommendations and Tutor grounding."
        actions={<WindowTabs value={range} onChange={(value) => setFilters({ range: value })} />}
      />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className={cn("space-y-6 transition-opacity", isPlaceholderData && "opacity-60")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Quizzes completed"
              value={formatNumber(data.quizzes.completed)}
              icon={<ListChecks />}
              hint={`${formatNumber(data.quizzes.started)} started · ${pct(data.quizzes.completionRate)} completion`}
            />
            <StatCard
              label="Questions answered"
              value={formatNumber(data.answers.answered)}
              icon={<CheckCircle2 />}
              tone="emerald"
              hint={`${pct(data.answers.accuracy)} correct · by ${pluralize(data.answers.learners, "learner")}`}
            />
            <StatCard
              label="Recommendations followed"
              value={pct(data.recommendations.actRate)}
              icon={<Lightbulb />}
              tone="amber"
              hint={`${data.recommendations.acted} of ${data.recommendations.generated} · ${data.recommendations.dismissed} dismissed`}
            />
            <StatCard
              label="Tutor answers from materials"
              value={pct(data.tutor.groundedRate)}
              icon={<MessageSquare />}
              tone="violet"
              hint={`${formatNumber(data.tutor.answers)} Tutor answers`}
            />
          </div>

          <Card className="grid gap-6 p-5 lg:grid-cols-2">
            <ColumnChart
              label="Answers per day"
              data={data.answers.series.map((d) => ({ key: d.date, label: bucketLabel(d.date), value: d.answered }))}
            />
            <LineChart
              label="Average score per day"
              tone="emerald"
              data={data.answers.series.map((d) => ({ key: d.date, label: shortDate(d.date), value: d.avgScore, detail: `${d.answered} answers` }))}
              emptyText="No graded answers in this period."
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Assessment performance" description="Average score by question type and difficulty" icon={<BookOpenCheck className="size-4" />} />
              <CardBody className="space-y-5">
                <ScoreBars rows={data.answers.byType.map((r) => ({ label: TYPE_LABEL[r.type] ?? r.type, value: r.avgScore, count: r.answered }))} />
                <ScoreBars
                  rows={[1, 2, 3, 4, 5].map((level) => {
                    const row = data.answers.byDifficulty.find((r) => r.difficulty === level);
                    return { label: `Level ${level}`, value: row?.avgScore ?? null, count: row?.answered ?? 0 };
                  })}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Concept mastery" description={`${formatNumber(data.mastery.assessedConcepts)} learner–concept estimates`} icon={<Lightbulb className="size-4" />} />
              <CardBody>
                <BandBar bands={{ ...data.mastery.bands, not_assessed: 0 }} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Tutor grounding" description="Where Zoya's answers came from" icon={<MessageSquare className="size-4" />} />
              <CardBody>
                {data.tutor.answers === 0 ? (
                  <p className="py-4 text-sm text-muted">No Tutor answers in this period.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {[...data.tutor.grounding]
                      .sort((a, b) => b.count - a.count)
                      .map((g) => (
                        <li key={g.status} className="flex items-center justify-between gap-3">
                          <span className="text-ink-soft">{GROUNDING_LABEL[g.status] ?? g.status}</span>
                          <span className="text-muted tabular-nums">
                            <strong className="font-semibold text-ink">{g.count}</strong> · {pct(g.count / data.tutor.answers)}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <p className="border-b border-line px-5 py-3 font-display text-[15px] font-semibold text-ink">
              Hardest concepts <span className="text-sm font-normal text-muted">· lowest average score, at least 3 answers</span>
            </p>
            <Table>
              <thead>
                <tr>
                  <Th>Concept</Th>
                  <Th>Project</Th>
                  <Th className="text-right">Answers</Th>
                  <Th className="text-right">Learners</Th>
                  <Th className="text-right">Average score</Th>
                </tr>
              </thead>
              <tbody>
                {data.hardestConcepts.length === 0 ? (
                  <EmptyRow colSpan={5}>Not enough answers yet — concepts appear here after 3 graded answers.</EmptyRow>
                ) : (
                  data.hardestConcepts.map((c) => (
                    <tr key={c.conceptId}>
                      <Td className="font-medium text-ink">{c.name}</Td>
                      <Td>{c.project ?? "—"}</Td>
                      <Td className="text-right tabular-nums">{c.answered}</Td>
                      <Td className="text-right tabular-nums">{c.learners}</Td>
                      <Td className={cn("text-right font-semibold tabular-nums", c.avgScore < 0.5 ? "text-rose-600" : c.avgScore < 0.8 ? "text-amber-600" : "text-emerald-600")}>
                        {pct(c.avgScore)}
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function AdminLearningPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <LearningView />
    </Suspense>
  );
}
