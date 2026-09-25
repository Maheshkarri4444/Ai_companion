"use client";

import {
  Check,
  CircleHelp,
  FileText,
  Flag,
  Lightbulb,
  Loader2,
  PenLine,
  ListChecks,
  TriangleAlert,
  X,
  CircleDashed,
  CircleCheck,
  CircleX,
  CircleMinus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnswerMarkdown } from "@/components/tutor/answer-markdown";
import { passagePreview } from "@/components/tutor/chat-message";
import type { ViewableSource } from "@/components/tutor/source-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { errorMessage } from "@/lib/api";
import { useReportQuizItem } from "@/lib/queries";
import type { KeyPointResult, OptionId, QuizAttempt, QuizQuestion, QuizReportReason, QuizSource, TutorSource } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LEVEL_LABELS, MasteryChange, pct } from "./mastery";

const MAX_ANSWER = 4000;
const OPTION_KEYS: Record<string, OptionId> = { a: "A", b: "B", c: "C", d: "D", "1": "A", "2": "B", "3": "C", "4": "D" };

/** Stems never need citation markers; a stray one would render as a dead chip. */
export const cleanStem = (stem: string) => stem.replace(/\s?\[S\d{1,2}\]/g, "");

/** Quiz sources in the shape the Markdown citation chips expect. */
function asTutorSources(sources: QuizSource[]): TutorSource[] {
  return sources.map((s) => ({ ...s, kind: "chunk", score: null, origin: "retrieval", flagged: false }));
}

const pages = (s: { pageStart: number; pageEnd: number }) => (s.pageStart === s.pageEnd ? `Page ${s.pageStart}` : `Pages ${s.pageStart}–${s.pageEnd}`);

/* ──────────────────────────────── Header ──────────────────────────────── */

export function DifficultyDots({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={`Difficulty ${value} of 5`}>
      <span className="flex gap-0.5" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={cn("size-1.5 rounded-full", i < value ? "bg-blue-600" : "bg-slate-200")} />
        ))}
      </span>
      <span className="sr-only">Difficulty {value} of 5</span>
    </span>
  );
}

export function QuestionMeta({ question }: { question: QuizQuestion }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {question.conceptNames[0] && <Badge tone="blue">{question.conceptNames[0]}</Badge>}
      <Badge tone="slate">
        {question.type === "mcq" ? <ListChecks className="size-3" /> : <PenLine className="size-3" />}
        {question.type === "mcq" ? "Multiple choice" : "Written answer"}
      </Badge>
      <Badge tone="indigo">{LEVEL_LABELS[question.cognitiveLevel]}</Badge>
      <DifficultyDots value={question.difficulty} />
    </div>
  );
}

/** "Why this question?" — the adaptive engine explains itself (PRD: explainability). */
export function WhyThisQuestion({ question }: { question: QuizQuestion }) {
  const { selection } = question;
  if (!selection.reason) return null;
  return (
    <details className="group rounded-xl border border-line bg-slate-50/70 px-3 py-2 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-blue-700 select-none">
        <CircleHelp className="size-3.5" /> Why this question?
      </summary>
      <div className="mt-2 space-y-1 text-[13px] leading-relaxed text-ink-soft">
        <p>{selection.reason}</p>
        <p className="text-xs text-muted">
          {selection.evidence > 0 && selection.mastery != null ? (
            <>
              Current mastery {pct(selection.mastery)} from {selection.evidence} answer{selection.evidence === 1 ? "" : "s"}
            </>
          ) : (
            <>First question on this concept</>
          )}
          {selection.predictedP != null && <> · pitched so you have about a {pct(selection.predictedP)} chance of getting it right</>}
          {selection.explored && <> · chosen to explore</>}
        </p>
      </div>
    </details>
  );
}

/* ───────────────────────────── Answer form ───────────────────────────── */

export interface AnswerSubmission {
  optionId?: OptionId;
  text?: string;
  skipped?: boolean;
}

export function AnswerForm({
  question,
  submitting,
  onSubmit,
}: {
  question: QuizQuestion;
  submitting: boolean;
  onSubmit: (answer: AnswerSubmission) => void;
}) {
  const [selected, setSelected] = useState<OptionId | null>(null);
  const [text, setText] = useState("");
  const canSubmit = question.type === "mcq" ? Boolean(selected) : text.trim().length > 0;

  function submit() {
    if (!canSubmit || submitting) return;
    onSubmit(question.type === "mcq" ? { optionId: selected! } : { text: text.trim() });
  }
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  // Keyboard: A–D / 1–4 pick an option, Enter submits (not while typing elsewhere or with a menu open).
  useEffect(() => {
    if (question.type !== "mcq") return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [role=menu], [role=dialog]")) return;
      if (event.key === "Enter") {
        // A focused ordinary button keeps its own Enter; on the page or an option, Enter submits.
        if (target?.closest("button:not([role=radio]), a")) return;
        event.preventDefault();
        submitRef.current();
        return;
      }
      const option = OPTION_KEYS[event.key.toLowerCase()];
      if (option && question.options.some((o) => o.id === option)) {
        setSelected(option);
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [question]);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {question.type === "mcq" ? (
        <div role="radiogroup" aria-label="Answer options" className="space-y-2.5">
          {question.options.map((option) => {
            const active = selected === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(option.id)}
                disabled={submitting}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                  active ? "border-blue-500 bg-blue-50/70 ring-4 ring-blue-500/10" : "border-line bg-white hover:border-blue-200 hover:bg-slate-50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
                    active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {option.id}
                </span>
                <AnswerMarkdown content={option.text} sources={[]} className="prose-option min-w-0 flex-1" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor={`answer-${question.id}`} className="sr-only">
            Your answer
          </label>
          <Textarea
            id={`answer-${question.id}`}
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, MAX_ANSWER))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Explain in your own words — the key ideas matter more than perfect wording."
            className="min-h-36"
            disabled={submitting}
            autoFocus
          />
          <p className="flex justify-between text-xs text-muted">
            <span>Graded against a rubric of key points from your materials · Ctrl/⌘ + Enter to submit</span>
            <span className={cn("tabular-nums", text.length > MAX_ANSWER * 0.9 && "text-amber-700")}>
              {text.length}/{MAX_ANSWER}
            </span>
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!canSubmit} loading={submitting}>
          {submitting && question.type === "open" ? "Grading…" : "Submit answer"}
        </Button>
        <Button type="button" variant="ghost" disabled={submitting} onClick={() => onSubmit({ skipped: true })}>
          I don&apos;t know
        </Button>
        {question.type === "mcq" && <span className="ml-auto hidden text-xs text-muted sm:inline">Tip: press A–D, then Enter</span>}
      </div>
    </form>
  );
}

/* ─────────────────────────────── Feedback ─────────────────────────────── */

function verdictOf(question: QuizQuestion, attempt: QuizAttempt) {
  if (attempt.grading.status === "pending") return { tone: "slate", title: "Grading your answer…", Icon: Loader2 } as const;
  if (attempt.grading.status === "failed") return { tone: "amber", title: "We couldn't grade this answer", Icon: TriangleAlert } as const;
  if (attempt.response.skipped) return { tone: "blue", title: "Here's the answer", Icon: Lightbulb } as const;
  if (attempt.isCorrect) return { tone: "green", title: question.type === "open" && (attempt.outcome ?? 0) < 0.9 ? "Good answer" : "Correct", Icon: Check } as const;
  if (question.type === "open" && (attempt.outcome ?? 0) >= 0.4) return { tone: "amber", title: "Partly there", Icon: CircleMinus } as const;
  return { tone: "red", title: "Not quite", Icon: X } as const;
}

const VERDICT_TONES = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-900 [&_svg]:text-emerald-600",
  red: "border-rose-200 bg-rose-50 text-rose-900 [&_svg]:text-rose-600",
  amber: "border-amber-200 bg-amber-50 text-amber-900 [&_svg]:text-amber-600",
  blue: "border-blue-200 bg-blue-50 text-blue-900 [&_svg]:text-blue-600",
  slate: "border-line bg-slate-50 text-ink-soft [&_svg]:text-blue-600",
} as const;

function KeyPointRow({ point }: { point: KeyPointResult }) {
  const meta = {
    covered: { Icon: CircleCheck, tone: "text-emerald-600", label: "Covered" },
    partial: { Icon: CircleDashed, tone: "text-amber-600", label: "Partly covered" },
    missing: { Icon: CircleX, tone: "text-rose-500", label: "Missing" },
  }[point.status];
  return (
    <li className="flex items-start gap-2.5">
      <meta.Icon className={cn("mt-0.5 size-4 shrink-0", meta.tone)} aria-label={meta.label} />
      <div className="min-w-0 text-sm leading-relaxed">
        <p className="text-ink-soft">{point.point}</p>
        {point.evidence && point.status !== "missing" && <p className="mt-0.5 text-xs text-muted italic">You wrote: “{point.evidence}”</p>}
      </div>
    </li>
  );
}

function McqReview({
  question,
  attempt,
  sources,
  onOpenSource,
}: {
  question: QuizQuestion;
  attempt: QuizAttempt | null;
  sources: TutorSource[];
  onOpenSource: (source: ViewableSource) => void;
}) {
  const chosen = attempt?.response.optionId ?? null;
  return (
    <ul className="space-y-2">
      {question.options.map((option) => {
        const correct = option.id === question.correctOptionId;
        const picked = option.id === chosen;
        return (
          <li
            key={option.id}
            className={cn(
              "rounded-xl border px-4 py-3",
              correct ? "border-emerald-300 bg-emerald-50/60" : picked ? "border-rose-300 bg-rose-50/60" : "border-line bg-white",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
                  correct ? "bg-emerald-600 text-white" : picked ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-600",
                )}
              >
                {correct ? <Check className="size-3.5" /> : picked ? <X className="size-3.5" /> : option.id}
              </span>
              <div className="min-w-0 flex-1">
                <AnswerMarkdown content={option.text} sources={[]} className="prose-option" />
                {option.rationale && (correct || picked) && (
                  <AnswerMarkdown content={option.rationale} sources={sources} onOpenSource={onOpenSource} className="prose-note mt-1" />
                )}
              </div>
              {picked && <span className="shrink-0 text-[11px] font-semibold tracking-wide text-muted uppercase">Your answer</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SourcesList({ sources, onOpen }: { sources: QuizSource[]; onOpen: (s: ViewableSource) => void }) {
  const shown = sources.filter((s) => s.cited).length ? sources.filter((s) => s.cited) : sources;
  if (shown.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-slate-50/70 p-2">
      <p className="flex items-center gap-1.5 px-2 pt-0.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
        <FileText className="size-3" /> From your materials
      </p>
      <ul>
        {shown.map((source) => {
          const preview = passagePreview(source.snippet, source.sectionTitle);
          return (
            <li key={source.ref}>
              <button
                type="button"
                onClick={() => onOpen(source)}
                className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-blue-50"
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-blue-600" />
                <span className="min-w-0 text-[13px] leading-snug">
                  <span className="text-muted">Source: </span>
                  <span className="font-medium text-ink">{source.materialTitle}</span>
                  <span className="text-muted"> — </span>
                  <span className="font-medium text-blue-700">{pages(source)}</span>
                  {preview && <span className="block truncate text-xs text-muted">“{preview}”</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const QUESTION_REASONS: Array<[QuizReportReason, string]> = [
  ["wrong_answer_key", "The marked answer is wrong"],
  ["unclear", "The question is unclear"],
  ["not_in_materials", "It isn't covered by my materials"],
  ["too_easy", "Too easy"],
  ["too_hard", "Too hard"],
  ["other", "Something else"],
];

function ReportMenu({ projectId, question, attempt }: { projectId: string; question: QuizQuestion; attempt: QuizAttempt }) {
  const report = useReportQuizItem(projectId, question.sessionId);
  const [done, setDone] = useState(attempt.reported);

  async function send(target: "question" | "grading", reason: QuizReportReason) {
    try {
      await report.mutateAsync({ questionId: question.id, target, reason });
      setDone(true);
      toast.success(target === "grading" ? "Thanks — the grading will be reviewed." : "Thanks — the question will be reviewed.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <Flag className="size-3" /> Reported
      </span>
    );
  }
  return (
    <Menu
      align="start"
      trigger={
        <button type="button" className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted transition-colors hover:bg-slate-100 hover:text-ink">
          <Flag className="size-3" /> Report a problem
        </button>
      }
    >
      {attempt.grading.method === "ai" && attempt.grading.status === "graded" && (
        <>
          <MenuItem onSelect={() => send("grading", "unfair_grade")}>My answer was graded unfairly</MenuItem>
          <MenuSeparator />
        </>
      )}
      <MenuLabel>What&apos;s wrong with the question?</MenuLabel>
      {QUESTION_REASONS.map(([reason, label]) => (
        <MenuItem key={reason} onSelect={() => send("question", reason)}>
          {label}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** What the learner got right, what is missing, the full answer and where it comes from — never just a score. */
export function AnswerFeedback({
  projectId,
  question,
  onOpenSource,
}: {
  projectId: string;
  question: QuizQuestion;
  onOpenSource: (source: ViewableSource) => void;
}) {
  const attempt = question.attempt;
  const tutorSources = useMemo(() => asTutorSources(question.sources), [question.sources]);
  if (!attempt) return null;
  const verdict = verdictOf(question, attempt);
  const feedback = attempt.feedback;
  const pending = attempt.grading.status === "pending";
  const showModelAnswer = question.type === "open" && question.rubric?.sampleAnswer;
  // For multiple choice the verdict says it all; the options below show why (the title already reads "Correct").
  const message = pending
    ? "Zoya is checking your answer against the key points in your materials. You can carry on — the result appears here."
    : question.type === "mcq" && !attempt.response.skipped
      ? attempt.isCorrect
        ? null
        : `The correct answer is ${question.correctOptionId}.`
      : (feedback?.summary ?? null);

  return (
    <div className="space-y-4" aria-live="polite">
      <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", VERDICT_TONES[verdict.tone])}>
        <verdict.Icon className={cn("mt-0.5 size-5 shrink-0", pending && "animate-spin")} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 font-semibold">
            {verdict.title}
            {question.type === "open" && attempt.outcome != null && !attempt.response.skipped && (
              <span className="text-sm font-medium opacity-80">Score {pct(attempt.outcome)}</span>
            )}
          </p>
          {message && <p className="mt-0.5 text-sm leading-relaxed opacity-90">{message}</p>}
        </div>
      </div>

      {question.type === "mcq" && <McqReview question={question} attempt={attempt} sources={tutorSources} onOpenSource={onOpenSource} />}

      {question.type === "open" && !pending && (
        <>
          {feedback && feedback.keyPoints.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">Key points</p>
              <ul className="space-y-2">
                {feedback.keyPoints.map((point, i) => (
                  <KeyPointRow key={i} point={point} />
                ))}
              </ul>
            </div>
          )}
          {feedback && feedback.misconceptions.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3">
              <p className="text-xs font-semibold tracking-wide text-rose-800 uppercase">Watch out</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-rose-950">
                {feedback.misconceptions.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {attempt.response.text && (
            <details className="rounded-xl border border-line px-4 py-2.5 text-sm">
              <summary className="cursor-pointer text-xs font-semibold tracking-wide text-muted uppercase select-none">Your answer</summary>
              <p className="mt-2 leading-relaxed whitespace-pre-wrap text-ink-soft">{attempt.response.text}</p>
            </details>
          )}
          {showModelAnswer && (
            <details className="rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-2.5 text-sm" open={!attempt.isCorrect}>
              <summary className="cursor-pointer text-xs font-semibold tracking-wide text-blue-800 uppercase select-none">Model answer</summary>
              <AnswerMarkdown content={question.rubric!.sampleAnswer} sources={tutorSources} onOpenSource={onOpenSource} className="mt-2" />
            </details>
          )}
        </>
      )}

      {question.explanation && !pending && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            <Lightbulb className="size-3.5" /> Explanation
          </p>
          <AnswerMarkdown content={question.explanation} sources={tutorSources} onOpenSource={onOpenSource} />
        </div>
      )}

      <SourcesList sources={question.sources} onOpen={onOpenSource} />

      {attempt.masteryDelta.length > 0 && (
        <div className="space-y-2 rounded-xl border border-line px-4 py-3">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Mastery</p>
          {attempt.masteryDelta.map((d) => (
            <MasteryChange key={d.conceptId} name={d.name} before={d.before} after={d.after} />
          ))}
        </div>
      )}

      {!pending && (
        <div className="-ml-1.5">
          <ReportMenu projectId={projectId} question={question} attempt={attempt} />
        </div>
      )}
    </div>
  );
}
