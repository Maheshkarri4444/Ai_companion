"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Flag, ListChecks, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AnswerFeedback, AnswerForm, cleanStem, QuestionMeta, WhyThisQuestion, type AnswerSubmission } from "@/components/quiz/question-card";
import { QuizResults } from "@/components/quiz/results";
import { AnswerMarkdown } from "@/components/tutor/answer-markdown";
import { SourceViewer, type ViewableSource } from "@/components/tutor/source-viewer";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ZoyaAvatar } from "@/components/zoya/zoya-avatar";
import { ApiError, errorMessage } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { qk, useAnswerQuestion, useCompleteQuiz, useNextQuestion, useQuizSession, useStartQuiz } from "@/lib/queries";
import { newClientMessageId } from "@/lib/tutor-stream";
import type { QuizQuestion, QuizSession } from "@/lib/types";

const MODE_LABELS = { adaptive: "Adaptive quiz", focused: "Focused practice", review: "Review" } as const;

export default function QuizSessionPage() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>();
  const { data, isLoading, error, refetch } = useQuizSession(projectId, sessionId);
  const [viewing, setViewing] = useState<ViewableSource | null>(null);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-6 w-60" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  }
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        icon={<ListChecks />}
        title="Quiz not found"
        description="It may have been deleted with its Project, or the link is wrong."
        action={
          <Link href={`/projects/${projectId}/quiz`} className={buttonClasses("secondary", "sm")}>
            Back to quizzes
          </Link>
        }
      />
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <QuizFlow key={data.session.id} projectId={projectId} session={data.session} questions={data.questions} onOpenSource={setViewing} />
      <SourceViewer projectId={projectId} source={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function QuizFlow({
  projectId,
  session,
  questions,
  onOpenSource,
}: {
  projectId: string;
  session: QuizSession;
  questions: QuizQuestion[];
  onOpenSource: (source: ViewableSource) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const answer = useAnswerQuestion(projectId, session.id);
  const complete = useCompleteQuiz(projectId);
  const start = useStartQuiz(projectId);

  // After answering, the question stays on screen (with its feedback) until the learner moves on; otherwise the
  // session's current question is shown, and when there is none the next one is fetched.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const keys = useRef(new Map<string, string>());
  const shownAt = useRef(new Map<string, number>());

  const active = session.status === "active";
  const displayedId = activeId ?? session.currentQuestionId;
  const shown = displayedId ? (questions.find((q) => q.id === displayedId) ?? null) : null;
  const next = useNextQuestion(projectId, session.id, session.answeredCount, active && !displayedId);

  useEffect(() => {
    if (shown && !shown.attempt && !shownAt.current.has(shown.id)) shownAt.current.set(shown.id, Date.now());
  }, [shown]);

  async function submit(question: QuizQuestion, input: AnswerSubmission) {
    setActiveId(question.id); // keep this question (and then its feedback) on screen
    // One key per question: a retried submit (network error) is replayed by the server, never answered twice.
    const idempotencyKey = keys.current.get(question.id) ?? newClientMessageId();
    keys.current.set(question.id, idempotencyKey);
    const timeMs = Math.min(Date.now() - (shownAt.current.get(question.id) ?? Date.now()), 3_600_000);
    try {
      await answer.mutateAsync({ questionId: question.id, idempotencyKey, timeMs, ...input });
    } catch (err) {
      if (err instanceof ApiError && ["QUIZ_ENDED", "NOT_CURRENT_QUESTION"].includes(err.code)) {
        toast.error(err.message);
        setActiveId(null);
        await queryClient.invalidateQueries({ queryKey: qk.quizSession(projectId, session.id) });
        return;
      }
      toast.error(errorMessage(err));
    }
  }

  async function endQuiz() {
    try {
      await complete.mutateAsync(session.id);
      setEndOpen(false);
      setActiveId(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function practice(conceptIds: string[]) {
    try {
      const created = await start.mutateAsync({ mode: "focused", targetCount: 5, questionTypes: "mixed", conceptIds: conceptIds.slice(0, 8) });
      router.push(`/projects/${projectId}/quiz/${created.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <Link href={`/projects/${projectId}/quiz`} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Quizzes
      </Link>
      {active && (
        <Button variant="ghost" size="sm" onClick={() => setEndOpen(true)}>
          <Flag className="size-3.5" /> End quiz
        </Button>
      )}
    </div>
  );

  // Finished (or ended early) and nothing left on screen → results.
  if (!active && !shown?.attempt) {
    return (
      <div className="space-y-4">
        {header}
        <QuizResults
          projectId={projectId}
          session={session}
          questions={questions}
          onOpenSource={onOpenSource}
          onPractice={practice}
          practicing={start.isPending}
        />
      </div>
    );
  }

  const answeredNow = Boolean(shown?.attempt);
  const position = shown?.position ?? session.answeredCount + 1;
  const progress = Math.min(1, session.answeredCount / session.targetCount);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {header}

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-lg font-semibold text-ink">
            Question {Math.min(position, session.targetCount)} <span className="font-normal text-muted">of {session.targetCount}</span>
          </p>
          <p className="text-xs text-muted">
            {MODE_LABELS[session.mode]}
            {session.gradedCount > 0 && (
              <>
                {" "}
                · {session.correctCount}/{session.gradedCount} correct
              </>
            )}
          </p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={session.targetCount} aria-valuenow={session.answeredCount}>
          <div className="h-full rounded-full bg-linear-to-r from-blue-500 to-indigo-600 transition-all duration-500" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      {shown ? (
        <Card className="animate-rise">
          <CardBody className="space-y-5">
            <div className="space-y-3">
              <QuestionMeta question={shown} />
              <AnswerMarkdown content={cleanStem(shown.stem)} sources={[]} className="prose-stem" />
              {!answeredNow && <WhyThisQuestion question={shown} />}
            </div>

            {answeredNow ? (
              <>
                <AnswerFeedback projectId={projectId} question={shown} onOpenSource={onOpenSource} />
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
                  <Button onClick={() => setActiveId(null)}>
                    {active ? "Next question" : "See your results"} <ArrowRight className="size-4" />
                  </Button>
                </div>
              </>
            ) : (
              <AnswerForm key={shown.id} question={shown} submitting={answer.isPending} onSubmit={(input) => submit(shown, input)} />
            )}
          </CardBody>
        </Card>
      ) : next.error ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
            <ZoyaAvatar size={44} />
            <div className="max-w-md">
              <p className="font-display font-semibold text-ink">Couldn&apos;t prepare the next question</p>
              <p className="mt-1 text-sm text-muted">{errorMessage(next.error)}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void next.refetch()} loading={next.isFetching}>
                <RotateCcw className="size-4" /> Try again
              </Button>
              {session.answeredCount > 0 && (
                <Button variant="secondary" onClick={() => setEndOpen(true)}>
                  Finish with {pluralize(session.answeredCount, "answer")}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="flex flex-col items-center gap-4 py-14 text-center" aria-live="polite" aria-busy>
            <ZoyaAvatar size={48} state="thinking" />
            <div className="max-w-md">
              <p className="font-display font-semibold text-ink">{session.answeredCount === 0 ? "Preparing your first question…" : "Preparing your next question…"}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Zoya picks the concept and difficulty from what you know so far, then writes a question from your materials and checks it
                against the sources.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={endOpen}
        onOpenChange={setEndOpen}
        title="End this quiz?"
        description={
          session.answeredCount > 0
            ? `Your ${pluralize(session.answeredCount, "answer")} so far are kept and count towards your mastery.`
            : "You haven't answered any question yet, so nothing will be recorded."
        }
        confirmLabel="End quiz"
        onConfirm={endQuiz}
        loading={complete.isPending}
      />
    </div>
  );
}
