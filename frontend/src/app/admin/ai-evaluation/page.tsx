"use client";

import { BookOpenCheck, CheckCircle2, ClipboardCheck, FlaskConical, Gavel, Hourglass, Lightbulb, ListChecks, Sparkles, Target, ThumbsUp, XCircle } from "lucide-react";
import { Suspense, useState } from "react";
import { AiCallDialog } from "@/components/admin/ai-call-dialog";
import { bucketLabel, RangeTabs } from "@/components/admin/column-chart";
import { EmptyRow, FilterBar, Table, Td, Th, useUrlFilters } from "@/components/admin/table";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { PageHeader, Pagination, StatCard } from "@/components/ui/misc";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import { useEvalRun, useEvaluationOverview, useEvaluations } from "@/lib/queries";
import type { AssessmentQuality, EvaluationOverview, RecommendationQuality } from "@/lib/types";
import { cn } from "@/lib/utils";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 1000) / 10}%`);
const score = (v: number | null | undefined) => (v == null ? "—" : `${(1 + v * 4).toFixed(2)} / 5`);
const VERDICT_TONE: Record<string, BadgeTone> = { pass: "green", warn: "amber", fail: "red" };
const EVALUATOR_LABEL: Record<string, string> = {
  rules: "Rule checks (every answer)",
  llm_judge: "LLM judge (sampled)",
  learner_feedback: "Learner feedback",
  offline_suite: "Offline suite",
};
const SUBJECT_LABEL: Record<string, string> = {
  tutor_message: "Tutor answers",
  quiz_question: "Quiz questions",
  quiz_grading: "Quiz grading",
  recommendation: "Recommendations",
};
const FLAG_LABEL: Record<string, string> = {
  regenerated: "Regenerated after validation",
  unknown_source_ids: "Cited unknown sources",
  correct_option_longest: "Correct option is the longest",
  missing_rationale: "Missing option rationale",
  difficulty_mismatch: "Difficulty mismatch (self-rated)",
  level_mismatch: "Level mismatch (self-rated)",
  evidence_not_in_answer: "Quoted evidence not in answer",
  score_disagreement: "Score vs. holistic disagreement",
  answer_flagged: "Answer tried to steer grading",
  aligned_with_attention: "Top item ignores a weak area",
  specific: "Doesn't name its concept",
  numbers_supported: "Number not in the facts",
  action_allowed: "Action not allowed",
  ids_in_project: "Concept outside the Project",
};
const GROUNDING_TONE: Record<string, string> = {
  grounded: "bg-emerald-500",
  partial: "bg-amber-400",
  insufficient: "bg-slate-400",
  general: "bg-indigo-400",
  conversational: "bg-cyan-400",
};

/** Stacked pass / warn / fail per bucket (2 px gaps between segments, legend always visible). */
function VerdictSeries({ data }: { data: EvaluationOverview["series"] }) {
  const max = Math.max(1, ...data.map((d) => d.pass + d.warn + d.fail));
  const [active, setActive] = useState<number | null>(null);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">Verdicts over time</p>
        <div className="flex gap-3 text-xs text-muted">
          {[
            ["Pass", "bg-emerald-500"],
            ["Warn", "bg-amber-400"],
            ["Fail", "bg-red-500"],
          ].map(([label, color]) => (
            <span key={label} className="flex items-center gap-1">
              <span className={cn("size-2.5 rounded-sm", color)} /> {label}
            </span>
          ))}
        </div>
      </div>
      <div className="relative flex h-32 items-end gap-[2px] border-b border-line-strong">
        {data.map((d, i) => {
          const total = d.pass + d.warn + d.fail;
          return (
            <button
              key={d.bucket}
              type="button"
              className="flex h-full flex-1 flex-col-reverse items-center justify-start outline-none"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${bucketLabel(d.bucket)}: ${d.pass} pass, ${d.warn} warn, ${d.fail} fail`}
            >
              {total > 0 &&
                (
                  [
                    [d.pass, "bg-emerald-500"],
                    [d.warn, "bg-amber-400"],
                    [d.fail, "bg-red-500"],
                  ] as const
                )
                  .filter(([n]) => n > 0)
                  .map(([n, color], j, arr) => (
                    <span
                      key={color}
                      className={cn("w-full max-w-6", color, j === arr.length - 1 && "rounded-t-[4px]", j > 0 && "mb-[2px]", active !== null && active !== i && "opacity-45")}
                      style={{ height: Math.max(2, (n / max) * 128) }}
                    />
                  ))}
            </button>
          );
        })}
        {active !== null && data[active] && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-navy-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white"
            style={{ left: `${((active + 0.5) / data.length) * 100}%` }}
          >
            <p className="text-[10px] text-blue-200">{bucketLabel(data[active].bucket)}</p>
            <p>
              {data[active].pass} pass · {data[active].warn} warn · {data[active].fail} fail
            </p>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{data[0] && bucketLabel(data[0].bucket)}</span>
        <span>{data.at(-1) && bucketLabel(data.at(-1)!.bucket)}</span>
      </div>
    </div>
  );
}

function RunDialog({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const { data, isLoading } = useEvalRun(runId);
  return (
    <Dialog open={Boolean(runId)} onOpenChange={(open) => !open && onClose()} title="Offline regression run" size="lg">
      {isLoading || !data ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {data.suite} · {formatDateTime(data.createdAt)} · {data.provider} · primary {data.models.primary} · prompts{" "}
            {Object.entries(data.promptVersions)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.summary.metrics).map(([k, v]) => (
              <Badge key={k} tone="slate">
                {k}: {k.includes("Ms") ? `${formatNumber(v)} ms` : k.includes("Cost") ? `$${v}` : v <= 1 ? pct(v) : v}
              </Badge>
            ))}
          </div>
          <ul className="divide-y divide-line">
            {data.cases.map((c) => (
              <li key={c.id} className="py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {c.passed ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-red-600" />}
                  <span className="font-medium text-ink">{c.id}</span>
                  <Badge tone="slate">{c.category}</Badge>
                  {c.grounding && <Badge tone="blue">{c.grounding}</Badge>}
                  <span className="ml-auto text-xs text-muted">{formatNumber(c.latencyMs)} ms</span>
                </p>
                <p className="mt-0.5 pl-6 text-xs text-muted">“{c.question}”</p>
                {c.citedPages.length > 0 && <p className="pl-6 text-xs text-muted">Cited: {c.citedPages.join(", ")}</p>}
                {c.checks.some((k) => !k.passed) && (
                  <p className="pl-6 text-xs text-red-700">
                    Failed: {c.checks.filter((k) => !k.passed).map((k) => `${k.name}${k.detail ? ` (${k.detail})` : ""}`).join("; ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

function FlagList({ flags, empty }: { flags: Array<{ flag: string; count: number }>; empty: string }) {
  if (flags.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {flags.map((f) => (
        <li key={f.flag} className="flex items-center justify-between gap-3">
          <span className="text-ink-soft" title={f.flag}>
            {FLAG_LABEL[f.flag] ?? f.flag.replace(/_/g, " ")}
          </span>
          <span className="text-muted tabular-nums">{f.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Quiz generation and grading (PRD §14): validity of every generated item, grading checks, the sampled judge, reports. */
function AssessmentQualitySection({ data }: { data: AssessmentQuality }) {
  const judge = data.judge;
  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <ClipboardCheck className="size-5 text-blue-600" /> Assessment quality
        </h2>
        <p className="text-sm text-muted">
          Every generated question is validated before it is shown; open answers are graded against a rubric and checked; a sample of questions (and
          every reported one) goes to the judge.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Questions accepted"
          value={pct(data.generation?.validRate)}
          icon={<ListChecks />}
          hint={data.generation ? `${formatNumber(data.generation.items)} generated · ${pct(data.generation.firstPassRate)} first try` : "No questions yet"}
        />
        <StatCard
          label="Judge: questions pass"
          value={pct(judge?.passRate)}
          icon={<Gavel />}
          tone="indigo"
          hint={judge ? `${judge.samples} judged · answer key ${score(judge.keyCorrect)}` : "No judged questions yet"}
        />
        <StatCard
          label="Grading checks passed"
          value={pct(data.grading?.passRate)}
          icon={<CheckCircle2 />}
          tone="emerald"
          hint={data.grading ? `${formatNumber(data.grading.graded)} AI-graded answers` : "No written answers graded yet"}
        />
        <StatCard
          label="Grading backlog"
          value={formatNumber(data.gradingBacklog.pending)}
          icon={<Hourglass />}
          tone="amber"
          hint={`${data.gradingBacklog.failed} could not be graded · ${data.learnerReports} learner reports`}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <p className="mb-3 font-display text-[15px] font-semibold text-ink">Judge scores (questions)</p>
          {!judge ? (
            <p className="text-sm text-muted">No judged questions in this period.</p>
          ) : (
            <dl className="space-y-1.5 text-sm">
              {(
                [
                  ["Answerable from sources", judge.answerable],
                  ["Answer key correct", judge.keyCorrect],
                  ["Distractor quality", judge.distractors],
                  ["Clarity", judge.clarity],
                  ["Difficulty as targeted", judge.difficultyMatch],
                  ["Level as targeted", judge.levelMatch],
                ] as Array<[string, number]>
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <dt className="text-ink-soft">{label}</dt>
                  <dd className="text-muted tabular-nums">{score(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
        <Card className="p-5">
          <p className="mb-3 font-display text-[15px] font-semibold text-ink">Generation warnings</p>
          <FlagList flags={data.generation?.topFlags ?? []} empty="No warnings in this period." />
        </Card>
        <Card className="p-5">
          <p className="mb-3 font-display text-[15px] font-semibold text-ink">Grading flags</p>
          {data.grading && (
            <p className="mb-2 text-xs text-muted">
              Evidence verified {pct(data.grading.grounded)} · score consistent {pct(data.grading.consistency)}
            </p>
          )}
          <FlagList flags={data.grading?.topFlags ?? []} empty="No grading flags in this period." />
        </Card>
      </div>
    </section>
  );
}

function RecommendationQualitySection({ data }: { data: RecommendationQuality }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <Lightbulb className="size-5 text-blue-600" /> Recommendation quality
        </h2>
        <p className="text-sm text-muted">
          Rules choose each next action from the learner&apos;s evidence; the model only rephrases it. Every recommendation is checked as the learner
          reads it — relevant (names its concept), actionable (allowed action, ids in the Project) and aligned with what needs attention.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Rule checks passed" value={pct(data.passRate)} icon={<ListChecks />} hint={`${formatNumber(data.checked)} recommendations checked`} />
        <StatCard label="Aligned with attention" value={pct(data.alignedRate)} icon={<Target />} tone="indigo" hint={`Actionable ${pct(data.actionableRate)}`} />
        <StatCard label="Phrased by AI" value={pct(data.aiPhrasedRate)} icon={<Sparkles />} tone="violet" hint="The rest kept the rule template" />
        <StatCard
          label="Followed by learners"
          value={pct(data.followRate)}
          icon={<ThumbsUp />}
          tone="emerald"
          hint={`${data.followed} followed · ${data.dismissed} dismissed of ${data.generated}`}
        />
      </div>
      <Card className="p-5">
        <p className="mb-3 font-display text-[15px] font-semibold text-ink">Rule failures</p>
        <FlagList flags={data.topFlags} empty="No failed checks in this period." />
      </Card>
    </section>
  );
}

function EvaluationView() {
  const [filters, setFilters] = useUrlFilters({ range: "7d", evaluator: "", verdict: "", subject: "", page: "1" });
  const page = Number(filters.page) || 1;
  const overview = useEvaluationOverview(filters.range);
  const list = useEvaluations({ evaluator: filters.evaluator, verdict: filters.verdict, subjectType: filters.subject, page, limit: 12 });
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const data = overview.data;
  const byEvaluator = (name: string) => data?.evaluators.find((e) => e.evaluator === name);
  const feedback = byEvaluator("learner_feedback");
  const totalGrounding = data?.groundingDistribution.reduce((n, g) => n + g.count, 0) ?? 0;

  return (
    <div className="animate-rise space-y-6">
      <PageHeader
        title="AI evaluation"
        description="Quality of Zoya's answers from four evaluators — rule checks on every answer, a sampled LLM judge, learner feedback and the offline regression suite — and of the quiz questions and grading."
        actions={<RangeTabs value={filters.range} onChange={(range) => setFilters({ range })} />}
      />

      {overview.error ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Rule checks passed"
              value={pct(byEvaluator("rules")?.passRate)}
              icon={<ListChecks />}
              hint={`${formatNumber(byEvaluator("rules")?.total ?? 0)} answers checked`}
            />
            <StatCard
              label="Judge: groundedness"
              value={score(data.judge?.groundedness)}
              icon={<Gavel />}
              tone="indigo"
              hint={data.judge ? `${data.judge.samples} judged · citations ${score(data.judge.citationAccuracy)}` : "No judged answers yet"}
            />
            <StatCard
              label="Unsupported-question handling"
              value={pct(data.judge?.unsupportedHandling)}
              icon={<BookOpenCheck />}
              tone="emerald"
              hint="Judge: refused to answer beyond the materials"
            />
            <StatCard
              label="Learner feedback"
              value={feedback?.total ? pct(feedback.passRate) : "—"}
              icon={<ThumbsUp />}
              tone="violet"
              hint={feedback?.total ? `${feedback.pass} 👍 · ${feedback.fail} 👎` : "No ratings yet"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card className="p-5">
              <VerdictSeries data={data.series} />
            </Card>
            <Card className="p-5">
              <p className="mb-3 text-sm font-medium text-ink">How Zoya answered</p>
              {totalGrounding === 0 ? (
                <p className="text-sm text-muted">No answers yet.</p>
              ) : (
                <>
                  <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
                    {data.groundingDistribution.map((g) => (
                      <span key={g.status} className={GROUNDING_TONE[g.status] ?? "bg-slate-300"} style={{ width: `${(g.count / totalGrounding) * 100}%` }} />
                    ))}
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {data.groundingDistribution
                      .sort((a, b) => b.count - a.count)
                      .map((g) => (
                        <li key={g.status} className="flex items-center gap-2">
                          <span className={cn("size-2.5 rounded-sm", GROUNDING_TONE[g.status] ?? "bg-slate-300")} />
                          <span className="capitalize text-ink-soft">{g.status}</span>
                          <span className="ml-auto text-muted tabular-nums">
                            {g.count} · {pct(g.count / totalGrounding)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <p className="border-b border-line px-5 py-3 font-display text-[15px] font-semibold text-ink">Judge scores by prompt version</p>
              <Table className="[&_table]:min-w-0">
                <thead>
                  <tr>
                    <Th>Prompt</Th>
                    <Th className="text-right">Samples</Th>
                    <Th className="text-right">Grounded</Th>
                    <Th className="text-right">Citations</Th>
                    <Th className="text-right">Pass</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.byPromptVersion.length === 0 ? (
                    <EmptyRow colSpan={5}>No judged answers yet.</EmptyRow>
                  ) : (
                    data.byPromptVersion.map((p) => (
                      <tr key={p.promptVersion}>
                        <Td className="font-medium text-ink">{p.promptVersion}</Td>
                        <Td className="text-right tabular-nums">{p.samples}</Td>
                        <Td className="text-right tabular-nums">{score(p.groundedness)}</Td>
                        <Td className="text-right tabular-nums">{score(p.citationAccuracy)}</Td>
                        <Td className="text-right tabular-nums">{pct(p.passRate)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Card>
            <Card className="p-5">
              <p className="mb-3 font-display text-[15px] font-semibold text-ink">Most frequent rule failures</p>
              {data.topRuleFailures.length === 0 ? (
                <p className="text-sm text-muted">No rule failures in this period.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.topRuleFailures.map((r) => (
                    <li key={r.rule} className="flex items-center justify-between gap-3">
                      <code className="text-xs text-ink-soft">{r.rule}</code>
                      <span className="text-muted tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="overflow-hidden">
            <p className="flex items-center gap-2 border-b border-line px-5 py-3 font-display text-[15px] font-semibold text-ink">
              <FlaskConical className="size-4 text-blue-600" /> Offline regression runs
              <span className="text-xs font-normal text-muted">npm run eval:tutor -- --record</span>
            </p>
            <Table>
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Models · prompt</Th>
                  <Th className="text-right">Pass</Th>
                  <Th className="text-right">Grounded</Th>
                  <Th className="text-right">Unsupported</Th>
                  <Th className="text-right">Injection</Th>
                  <Th className="text-right">Retrieval hit@3</Th>
                  <Th className="text-right">Avg latency</Th>
                </tr>
              </thead>
              <tbody>
                {data.offlineRuns.length === 0 ? (
                  <EmptyRow colSpan={8}>No recorded runs yet.</EmptyRow>
                ) : (
                  data.offlineRuns.map((r) => {
                    const m = r.summary.metrics;
                    return (
                      <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenRun(r.id)}>
                        <Td>
                          <span className="font-medium text-ink">{r.label ?? r.suite}</span>
                          <span className="block text-xs text-muted">{timeAgo(r.createdAt)}</span>
                        </Td>
                        <Td className="text-xs">
                          {r.models.primary} · {r.promptVersions.tutor}
                        </Td>
                        <Td className="text-right font-medium tabular-nums">
                          {r.summary.passed}/{r.summary.cases}
                        </Td>
                        <Td className="text-right tabular-nums">{pct(m.groundedAccuracy)}</Td>
                        <Td className="text-right tabular-nums">{pct(m.unsupportedHandling)}</Td>
                        <Td className="text-right tabular-nums">{pct(m.injectionResistance)}</Td>
                        <Td className="text-right tabular-nums">{pct(m.retrievalHitAt3)}</Td>
                        <Td className="text-right tabular-nums">{formatNumber(m.avgLatencyMs)} ms</Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </Card>

          <AssessmentQualitySection data={data.assessment} />
          <RecommendationQualitySection data={data.recommendations} />
        </>
      )}

      <div>
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">Evaluated items</h2>
        <FilterBar>
          <Select value={filters.evaluator} onChange={(e) => setFilters({ evaluator: e.target.value })} className="sm:w-56" aria-label="Evaluator">
            <option value="">All evaluators</option>
            {Object.entries(EVALUATOR_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={filters.subject} onChange={(e) => setFilters({ subject: e.target.value })} className="sm:w-48" aria-label="Subject">
            <option value="">Everything evaluated</option>
            {Object.entries(SUBJECT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={filters.verdict} onChange={(e) => setFilters({ verdict: e.target.value })} className="sm:w-40" aria-label="Verdict">
            <option value="">Any verdict</option>
            <option value="pass">Pass</option>
            <option value="warn">Warn</option>
            <option value="fail">Fail</option>
          </Select>
        </FilterBar>
        <Card className="overflow-hidden">
          {list.error ? (
            <div className="p-5">
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            </div>
          ) : (
            <>
              <ul className={cn("divide-y divide-line", list.isPlaceholderData && "opacity-60")}>
                {list.isLoading ? (
                  <li className="p-5">
                    <Skeleton className="h-16" />
                  </li>
                ) : !list.data || list.data.items.length === 0 ? (
                  <li className="px-5 py-10 text-center text-sm text-muted">No evaluations match these filters.</li>
                ) : (
                  list.data.items.map((e) => (
                    <li key={e.id} className="space-y-1.5 px-5 py-3.5">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge tone={VERDICT_TONE[e.verdict]}>{e.verdict}</Badge>
                        <span className="font-medium text-ink">{EVALUATOR_LABEL[e.evaluator] ?? e.evaluator}</span>
                        <span className="text-muted">· {SUBJECT_LABEL[e.subjectType] ?? e.subjectType.replace(/_/g, " ")}</span>
                        {e.user && <span className="text-muted">· {e.user.name}</span>}
                        <span className="text-muted">· {e.promptVersion ?? "—"}</span>
                        <span className="ml-auto text-xs text-muted">{timeAgo(e.createdAt)}</span>
                      </p>
                      {e.inputPreview && <p className="truncate text-sm text-ink-soft">“{e.inputPreview}”</p>}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        {Object.entries(e.scores).map(([k, v]) => (
                          <span key={k} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-muted">
                            {k} {Math.round(v * 100)}%
                          </span>
                        ))}
                        {e.flags.map((f) => (
                          <Badge key={f} tone="amber">
                            {f}
                          </Badge>
                        ))}
                        {e.aiCallId && (
                          <button type="button" onClick={() => setOpenCall(e.aiCallId)} className="font-medium text-blue-700 hover:underline">
                            View AI call →
                          </button>
                        )}
                      </div>
                      {e.rationale && <p className="text-xs text-muted">{e.rationale}</p>}
                    </li>
                  ))
                )}
              </ul>
              {list.data && <Pagination page={page} limit={list.data.limit} total={list.data.total} onPageChange={(p) => setFilters({ page: String(p) })} />}
            </>
          )}
        </Card>
      </div>

      <AiCallDialog callId={openCall} onClose={() => setOpenCall(null)} />
      <RunDialog runId={openRun} onClose={() => setOpenRun(null)} />
    </div>
  );
}

export default function AiEvaluationPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <EvaluationView />
    </Suspense>
  );
}
