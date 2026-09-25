"use client";

import { BookOpen, Check, ChevronDown, Clock, Loader2, MessageSquareText, RotateCcw, Target, TrendingDown, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import type { ViewableSource } from "@/components/tutor/source-viewer";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDateTime, pluralize } from "@/lib/format";
import type { CognitiveLevel, QuizQuestion, QuizSession } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LEVEL_LABELS, MasteryChange, pct } from "./mastery";
import { AnswerFeedback, cleanStem, QuestionMeta } from "./question-card";

const MODE_LABELS = { adaptive: "Adaptive quiz", focused: "Focused practice", review: "Review" } as const;

function formatTime(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function ResultChip({ question }: { question: QuizQuestion }) {
  const attempt = question.attempt;
  if (!attempt) return <Badge tone="slate">Not answered</Badge>;
  if (attempt.grading.status === "pending")
    return (
      <Badge tone="slate">
        <Loader2 className="size-3 animate-spin" /> Grading
      </Badge>
    );
  if (attempt.grading.status === "failed") return <Badge tone="amber">Not graded</Badge>;
  if (attempt.response.skipped) return <Badge tone="blue">Didn&apos;t know</Badge>;
  if (attempt.isCorrect)
    return (
      <Badge tone="green">
        <Check className="size-3" /> {question.type === "open" ? pct(attempt.outcome) : "Correct"}
      </Badge>
    );
  return (
    <Badge tone={question.type === "open" && (attempt.outcome ?? 0) >= 0.4 ? "amber" : "red"}>
      <X className="size-3" /> {question.type === "open" ? pct(attempt.outcome) : "Incorrect"}
    </Badge>
  );
}

/** End of a quiz: score, mastery change per concept, what to practise, where to re-read, and every answer reviewed. */
export function QuizResults({
  projectId,
  session,
  questions,
  onOpenSource,
  onPractice,
  practicing,
}: {
  projectId: string;
  session: QuizSession;
  questions: QuizQuestion[];
  onOpenSource: (source: ViewableSource) => void;
  onPractice: (conceptIds: string[]) => void;
  practicing: boolean;
}) {
  const summary = session.summary;
  const answered = questions.filter((q) => q.attempt);
  if (!summary || session.status === "abandoned") {
    return (
      <Card>
        <CardBody className="space-y-3 text-center">
          <p className="font-display text-lg font-semibold text-ink">This quiz ended before any question was answered</p>
          <p className="text-sm text-muted">Nothing was recorded, so your mastery is unchanged.</p>
          <Link href={`/projects/${projectId}/quiz`} className={buttonClasses("primary", "md")}>
            Start a new quiz
          </Link>
        </CardBody>
      </Card>
    );
  }

  const weakIds = summary.byConcept.filter((c) => c.avgScore !== null && c.avgScore < 0.5).map((c) => c.conceptId);
  const levels = (Object.keys(summary.byLevel) as CognitiveLevel[]).filter((l) => summary.byLevel[l].n > 0);
  const firstWeak = summary.byConcept.find((c) => c.avgScore !== null && c.avgScore < 0.5);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="bg-linear-to-br from-navy-900 via-[#0f2a6b] to-blue-700 px-6 py-6 text-white">
          <p className="text-xs font-semibold tracking-wider text-cyan-200/90 uppercase">
            {MODE_LABELS[session.mode]} · {formatDateTime(session.completedAt ?? session.lastActivityAt)}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-4">
            <div>
              <p className="font-display text-4xl font-semibold tracking-tight">
                {summary.correct}
                <span className="text-2xl text-blue-200/80">/{summary.graded}</span>
              </p>
              <p className="text-sm text-blue-100/80">correct</p>
            </div>
            <div>
              <p className="font-display text-2xl font-semibold">{pct(summary.avgScore)}</p>
              <p className="text-sm text-blue-100/80">average score</p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 font-display text-2xl font-semibold">
                <Clock className="size-5 text-blue-200/80" />
                {formatTime(summary.timeMs)}
              </p>
              <p className="text-sm text-blue-100/80">{pluralize(summary.answered, "question")}</p>
            </div>
          </div>
          {summary.pending > 0 && (
            <p className="mt-4 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm text-blue-50">
              <Loader2 className="size-4 animate-spin" />
              {pluralize(summary.pending, "answer")} still being graded — these results update automatically.
            </p>
          )}
        </div>
        <CardBody className="flex flex-wrap gap-2">
          {weakIds.length > 0 && (
            <Button onClick={() => onPractice(weakIds)} loading={practicing}>
              <Target className="size-4" /> Practise what needs work
            </Button>
          )}
          <Link href={`/projects/${projectId}/quiz`} className={buttonClasses(weakIds.length ? "secondary" : "primary", "md")}>
            <RotateCcw className="size-4" /> New quiz
          </Link>
          {firstWeak && (
            <Link
              href={`/projects/${projectId}/tutor?ask=${encodeURIComponent(`Help me understand ${firstWeak.name} — I found it hard in a quiz`)}`}
              className={buttonClasses("ghost", "md")}
            >
              <MessageSquareText className="size-4" /> Ask Zoya about {firstWeak.name}
            </Link>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Mastery by concept" description="Estimated from your answers — the marker shows where you started." icon={<TrendingUp />} />
          <CardBody className="space-y-4">
            {summary.byConcept.map((c) => (
              <div key={c.conceptId}>
                <MasteryChange name={c.name} before={c.masteryBefore} after={c.masteryAfter} />
                <p className="mt-1 text-xs text-muted">
                  {pluralize(c.answered, "question")} · average score {pct(c.avgScore)}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>

        <div className="space-y-6">
          {(summary.strengths.length > 0 || summary.needsWork.length > 0) && (
            <Card>
              <CardBody className="space-y-4">
                {summary.strengths.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-emerald-700 uppercase">
                      <TrendingUp className="size-3.5" /> Strengths
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {summary.strengths.map((name) => (
                        <Badge key={name} tone="green">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {summary.needsWork.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-rose-700 uppercase">
                      <TrendingDown className="size-3.5" /> Needs work
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {summary.needsWork.map((name) => (
                        <Badge key={name} tone="red">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {levels.length > 0 && (
            <Card>
              <CardHeader title="By type of thinking" description="Remembering facts is not the same as applying them." />
              <CardBody>
                <ul className="space-y-2.5">
                  {levels.map((level) => {
                    const stat = summary.byLevel[level];
                    return (
                      <li key={level} className="flex items-center gap-3 text-sm">
                        <span className="w-28 shrink-0 text-ink-soft">{LEVEL_LABELS[level]}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn("h-full rounded-full", (stat.avgScore ?? 0) >= 0.7 ? "bg-emerald-500" : (stat.avgScore ?? 0) >= 0.4 ? "bg-amber-400" : "bg-rose-500")}
                            style={{ width: `${Math.max(3, (stat.avgScore ?? 0) * 100)}%` }}
                          />
                        </div>
                        <span className="w-20 shrink-0 text-right text-xs text-muted tabular-nums">
                          {pct(stat.avgScore)} · {stat.n}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          )}

          {summary.review.length > 0 && (
            <Card>
              <CardHeader title="Return to your material" description="The pages behind the answers that went wrong." icon={<BookOpen />} />
              <CardBody>
                <ul className="space-y-2">
                  {summary.review.map((r) => (
                    <li key={`${r.materialId}:${r.conceptName}`}>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenSource({
                            materialId: r.materialId,
                            materialTitle: r.materialTitle,
                            pageStart: r.pages[0] ?? 1,
                            pageEnd: r.pages[0] ?? 1,
                            sectionTitle: r.conceptName,
                            snippet: "",
                          })
                        }
                        className="flex w-full items-start gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/40"
                      >
                        <BookOpen className="mt-0.5 size-4 shrink-0 text-blue-600" />
                        <span className="min-w-0 text-sm">
                          <span className="font-medium text-ink">{r.materialTitle}</span>
                          <span className="text-muted"> — {r.pages.length === 1 ? "page" : "pages"} {r.pages.slice(0, 6).join(", ")}</span>
                          <span className="block text-xs text-muted">{r.conceptName}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader title="Your answers" description={`${pluralize(answered.length, "question")} — open one to see the feedback again.`} />
        <CardBody className="pt-3">
          <ol className="divide-y divide-line">
            {answered.map((question, i) => (
              <li key={question.id}>
                <details className="group py-3">
                  <summary className="flex cursor-pointer list-none items-start gap-3 select-none">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">{i + 1}</span>
                    <span className="min-w-0 flex-1 text-sm leading-relaxed text-ink">{cleanStem(question.stem)}</span>
                    <ResultChip question={question} />
                    <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-3 space-y-3 pl-9">
                    <QuestionMeta question={question} />
                    <AnswerFeedback projectId={projectId} question={question} onOpenSource={onOpenSource} />
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
