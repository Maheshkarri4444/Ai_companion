"use client";

import { ArrowRight, Brain, CheckCircle2, Clock, History, ListChecks, Loader2, PlayCircle, RotateCcw, Sparkles, Target, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ConceptMasteryRow, MasteryOverview, pct } from "@/components/quiz/mastery";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { StatCard } from "@/components/ui/misc";
import { errorMessage, fieldErrors } from "@/lib/api";
import { formatDateTime, formatNumber, pluralize, timeAgo } from "@/lib/format";
import { useQuizOverview, useStartQuiz } from "@/lib/queries";
import type { ConceptMastery, QuestionTypePreference, QuizMode, QuizOverview, QuizSession } from "@/lib/types";
import { cn } from "@/lib/utils";

const LENGTHS = [3, 5, 10, 15];
const MAX_FOCUS = 8;
const MODE_LABELS: Record<QuizMode, string> = { adaptive: "Adaptive", focused: "Focused", review: "Review" };

export default function QuizHomePage() {
  return (
    <Suspense fallback={<QuizHomeSkeleton />}>
      <QuizHome />
    </Suspense>
  );
}

function QuizHomeSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Skeleton className="h-96 rounded-2xl lg:col-span-2" />
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}

function QuizHome() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, isLoading, error, refetch } = useQuizOverview(projectId);
  if (isLoading) return <QuizHomeSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  return <QuizHomeContent projectId={projectId} overview={data} />;
}

function QuizHomeContent({ projectId, overview }: { projectId: string; overview: QuizOverview }) {
  const router = useRouter();
  const start = useStartQuiz(projectId);
  const { readiness, active, sessions, stats, mastery } = overview;

  async function startQuiz(input: { mode: QuizMode; targetCount: number; questionTypes: QuestionTypePreference; conceptIds: string[] }) {
    try {
      const session = await start.mutateAsync(input);
      router.push(`/projects/${projectId}/quiz/${session.id}`);
    } catch (err) {
      const fields = fieldErrors(err);
      toast.error(fields.conceptIds ?? errorMessage(err));
    }
  }

  if (!readiness.canStart) {
    return (
      <EmptyState
        icon={readiness.pendingMaterials > 0 ? <Loader2 className="animate-spin" /> : <Upload />}
        title={readiness.pendingMaterials > 0 ? "Your materials are still being processed" : "Quizzes are written from your materials"}
        description={
          readiness.pendingMaterials > 0
            ? "As soon as processing finishes, Zoya can write questions from them. You don't need to keep this page open."
            : "Upload a PDF to this Project. Once it's processed, every question is generated from — and cites — your own material."
        }
        action={
          <Link href={`/projects/${projectId}/materials`} className={buttonClasses("primary", "sm")}>
            {readiness.pendingMaterials > 0 ? "View materials" : "Upload material"}
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {active && <ResumeCard projectId={projectId} session={active} />}
        <StartQuizCard
          concepts={mastery.concepts}
          hasHistory={stats.questionsAnswered > 0}
          hasActive={Boolean(active)}
          starting={start.isPending}
          onStart={startQuiz}
        />
        <HistoryCard projectId={projectId} sessions={sessions} />
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 xl:grid-cols-2">
          <StatCard label="Quizzes" value={formatNumber(stats.quizzesCompleted)} icon={<CheckCircle2 />} tone="emerald" hint={stats.lastCompletedAt ? `Last ${timeAgo(stats.lastCompletedAt)}` : "None completed yet"} />
          <StatCard label="Accuracy" value={pct(stats.accuracy)} icon={<Target />} tone="indigo" hint={`${pluralize(stats.questionsAnswered, "graded answer")}`} />
        </div>
        <Card>
          <CardHeader title="Concept mastery" description="Estimated from your quiz answers — it updates after every question." icon={<Brain />} />
          <CardBody className="space-y-4">
            <MasteryOverview summary={mastery.summary} />
            {mastery.concepts.length > 0 ? (
              <ul className="divide-y divide-line">
                {[...mastery.concepts]
                  .sort((a, b) => (a.mastery ?? 2) - (b.mastery ?? 2) || b.importance - a.importance)
                  .slice(0, 12)
                  .map((concept) => (
                    <ConceptMasteryRow
                      key={concept.conceptId}
                      concept={concept}
                      practicing={start.isPending}
                      onPractice={(c) => startQuiz({ mode: "focused", targetCount: 5, questionTypes: "mixed", conceptIds: [c.conceptId] })}
                    />
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No concepts extracted yet.</p>
            )}
            {mastery.summary.assessedConcepts === 0 && (
              <p className="rounded-xl bg-blue-50/70 px-3 py-2 text-xs leading-relaxed text-blue-900">
                Mastery appears once you answer questions. A single score is never final — confidence grows with every answer.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ResumeCard({ projectId, session }: { projectId: string; session: QuizSession }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-blue-100 bg-linear-to-br from-blue-50 via-white to-indigo-50/60 p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-indigo-600 text-white shadow-glow">
          <PlayCircle className="size-[18px]" />
        </span>
        <div>
          <p className="text-xs font-semibold tracking-wider text-blue-700/80 uppercase">Quiz in progress</p>
          <p className="mt-0.5 font-display font-semibold text-ink">
            {session.answeredCount} of {session.targetCount} answered · {MODE_LABELS[session.mode]}
          </p>
          <p className="mt-0.5 text-sm text-muted">Started {timeAgo(session.startedAt)} — pick up where you left off.</p>
        </div>
      </div>
      <Link href={`/projects/${projectId}/quiz/${session.id}`} className={buttonClasses("primary", "md", "self-start sm:self-center")}>
        Resume <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-ink">{label}</p>
      <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
              value === option.value ? "bg-white text-blue-700 shadow-card" : "text-ink-soft hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModeOption({ active, disabled, onSelect, icon, title, body }: { active: boolean; disabled?: boolean; onSelect: () => void; icon: ReactNode; title: string; body: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50",
        active ? "border-blue-500 bg-blue-50/60 ring-4 ring-blue-500/10" : "border-line bg-white hover:border-blue-200",
      )}
    >
      <span className={cn("flex size-8 items-center justify-center rounded-lg [&>svg]:size-4", active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600")}>{icon}</span>
      <span className="text-sm font-semibold text-ink">{title}</span>
      <span className="text-xs leading-relaxed text-muted">{body}</span>
    </button>
  );
}

/** Pre-filled from `?focus=<conceptIds>&count=<n>` — the link behind the Tutor's "Start quiz" button. */
function StartQuizCard({
  concepts,
  hasHistory,
  hasActive,
  starting,
  onStart,
}: {
  concepts: ConceptMastery[];
  hasHistory: boolean;
  hasActive: boolean;
  starting: boolean;
  onStart: (input: { mode: QuizMode; targetCount: number; questionTypes: QuestionTypePreference; conceptIds: string[] }) => void;
}) {
  const params = useSearchParams();
  const known = new Set(concepts.map((c) => c.conceptId));
  const initialFocus = (params.get("focus") ?? "")
    .split(",")
    .filter((id) => known.has(id))
    .slice(0, MAX_FOCUS);
  const requested = Number(params.get("count"));
  const [mode, setMode] = useState<QuizMode>(initialFocus.length ? "focused" : "adaptive");
  const [count, setCount] = useState(Number.isInteger(requested) && requested >= 3 && requested <= 15 ? requested : 5);
  const [types, setTypes] = useState<QuestionTypePreference>("mixed");
  const [focus, setFocus] = useState<string[]>(initialFocus);
  const assessable = concepts.filter((c) => c.sources.some((s) => s.pages.length > 0));
  const lengths = LENGTHS.includes(count) ? LENGTHS : [...LENGTHS, count].sort((a, b) => a - b);

  function toggle(id: string) {
    setFocus((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length >= MAX_FOCUS ? current : [...current, id]));
  }

  const canStart = mode !== "focused" || focus.length > 0;

  return (
    <Card>
      <CardHeader
        title="Start a quiz"
        description="Every question is written from your materials, adapts to your answers and cites the page it comes from."
        icon={<ListChecks />}
      />
      <CardBody className="space-y-5">
        <div role="radiogroup" aria-label="Quiz type" className="grid gap-2.5 sm:grid-cols-3">
          <ModeOption
            active={mode === "adaptive"}
            onSelect={() => setMode("adaptive")}
            icon={<Sparkles />}
            title="Adaptive"
            body="Zoya chooses — weak spots, new concepts and spaced review, at the right difficulty."
          />
          <ModeOption active={mode === "focused"} onSelect={() => setMode("focused")} icon={<Target />} title="Focused" body="Practise the concepts you pick." />
          <ModeOption
            active={mode === "review"}
            disabled={!hasHistory}
            onSelect={() => setMode("review")}
            icon={<RotateCcw />}
            title="Review"
            body={hasHistory ? "Revisit your mistakes and concepts that are due." : "Available after your first answers."}
          />
        </div>

        {mode === "focused" && (
          <div className="space-y-2">
            <p className="flex items-baseline justify-between text-sm font-medium text-ink">
              Concepts to practise
              <span className="text-xs font-normal text-muted">
                {focus.length}/{MAX_FOCUS} selected
              </span>
            </p>
            <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto scrollbar-thin">
              {assessable.map((c) => {
                const selected = focus.includes(c.conceptId);
                return (
                  <button
                    key={c.conceptId}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(c.conceptId)}
                    disabled={!selected && focus.length >= MAX_FOCUS}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-45",
                      selected ? "border-blue-500 bg-blue-600 text-white" : "border-line bg-white text-ink-soft hover:border-blue-300",
                    )}
                    title={c.description}
                  >
                    {selected && <CheckCircle2 className="size-3.5" />}
                    {c.name}
                    {c.mastery != null && <span className={cn("text-xs", selected ? "text-blue-100" : "text-muted")}>{pct(c.mastery)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <Segmented label="Questions" value={count} options={lengths.map((n) => ({ value: n, label: String(n) }))} onChange={setCount} />
          <Segmented
            label="Question types"
            value={types}
            options={[
              { value: "mixed", label: "Mixed", title: "Mostly multiple choice, with written answers once you're warmed up" },
              { value: "mcq", label: "Multiple choice" },
              { value: "open", label: "Written" },
            ]}
            onChange={setTypes}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button onClick={() => onStart({ mode, targetCount: count, questionTypes: types, conceptIds: mode === "focused" ? focus : [] })} loading={starting} disabled={!canStart}>
            <PlayCircle className="size-4" /> Start quiz
          </Button>
          <p className="text-xs text-muted">
            {!canStart ? "Choose at least one concept." : hasActive ? "Starting a new quiz ends the one in progress — its answers are kept." : `About ${Math.max(2, Math.round(count * 0.8))} minutes`}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function HistoryCard({ projectId, sessions }: { projectId: string; sessions: QuizSession[] }) {
  return (
    <Card>
      <CardHeader title="Past quizzes" icon={<History />} />
      <CardBody className="pt-3">
        {sessions.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted">Completed quizzes appear here, with every answer and its feedback.</p>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/projects/${projectId}/quiz/${s.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-slate-50">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {s.correctCount}/{s.gradedCount} correct
                      <span className="font-normal text-muted"> · average {pct(s.avgScore)}</span>
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <Clock className="size-3" /> {formatDateTime(s.completedAt)} · {MODE_LABELS[s.mode]}
                      {s.summary?.needsWork.length ? <> · needs work: {s.summary.needsWork.slice(0, 2).join(", ")}</> : null}
                    </p>
                  </div>
                  {s.pendingCount > 0 && <Badge tone="slate">Grading</Badge>}
                  <ArrowRight className="size-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
