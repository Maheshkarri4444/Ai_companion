"use client";

import { ArrowRight, Check, ChartColumn, Clock, FileText, HardDrive, Lightbulb, ListChecks, Lock, MessageSquare, Sparkles, TrendingUp, Upload, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ActivityFeed } from "@/components/activity-feed";
import { RecommendationList } from "@/components/learning/recommendation-list";
import { NextStepCard } from "@/components/next-step-card";
import { MasteryBadge, MasteryBar, MasteryOverview, pct } from "@/components/quiz/mastery";
import { MaterialStatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { StatCard } from "@/components/ui/misc";
import { ZoyaAvatar } from "@/components/zoya/zoya-avatar";
import { formatBytes, formatNumber, pluralize, timeAgo } from "@/lib/format";
import { useConcepts, useProject, useRecommendations } from "@/lib/queries";
import type { Concept, ProjectDashboard } from "@/lib/types";
import { cn } from "@/lib/utils";

type StepState = "done" | "current" | "upcoming" | "locked";

/** A learning-path step links to its section unless it is still locked. */
function PathStep({ href, children }: { href: string | null; children: React.ReactNode }) {
  const className = "flex items-center gap-3 rounded-xl sm:flex-col sm:text-center";
  return href ? (
    <Link href={href} className={cn(className, "group transition-opacity hover:opacity-80")}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

function LearningPath({
  projectId,
  materialCount,
  pending,
  ready,
  learning,
}: {
  projectId: string;
  materialCount: number;
  pending: number;
  ready: number;
  learning: ProjectDashboard["learning"];
}) {
  const { tutorUsed, quizzesCompleted, activeQuiz, accuracy, mastery } = learning;
  const assessed = mastery.assessedConcepts > 0;
  const base = `/projects/${projectId}`;
  const steps: Array<{ label: string; detail: string; icon: LucideIcon; state: StepState; href: string; lockedHint?: string }> = [
    {
      label: "Materials",
      href: `${base}/materials`,
      detail: materialCount === 0 ? "Upload your PDFs" : pending > 0 ? `${pending} processing` : `${materialCount} added`,
      icon: FileText,
      state: materialCount > 0 && ready > 0 ? "done" : "current",
    },
    {
      label: "AI Tutor",
      href: `${base}/tutor`,
      detail: tutorUsed ? "Learning with Zoya" : "Ask Zoya — cited answers",
      icon: MessageSquare,
      state: tutorUsed ? "done" : ready > 0 ? "current" : "locked",
      lockedHint: "Needs a processed material",
    },
    {
      label: "Quiz",
      href: `${base}/quiz`,
      detail: activeQuiz
        ? `In progress · ${activeQuiz.answered}/${activeQuiz.target}`
        : quizzesCompleted > 0
          ? `${pluralize(quizzesCompleted, "quiz", "quizzes")}${accuracy != null ? ` · ${Math.round(accuracy * 100)}% correct` : ""}`
          : "Adaptive practice",
      icon: ListChecks,
      state: quizzesCompleted > 0 ? "done" : ready > 0 ? "current" : "locked",
      lockedHint: "Needs a processed material",
    },
    {
      label: "Growth",
      href: `${base}/growth`,
      detail: assessed ? `${pct(mastery.overallMastery)} mastery · ${mastery.needsAttention} need attention` : "After your first quiz",
      icon: TrendingUp,
      state: assessed ? "done" : "upcoming",
    },
    {
      label: "Analytics",
      href: `${base}/analytics`,
      detail: tutorUsed || quizzesCompleted > 0 ? "Activity & performance" : "Progress over time",
      icon: ChartColumn,
      state: tutorUsed || quizzesCompleted > 0 ? "done" : "upcoming",
    },
  ];

  return (
    <ol className="grid gap-3 sm:grid-cols-5">
      {steps.map(({ label, detail, icon: Icon, state, href, lockedHint }, i) => (
        <li key={label} className="relative">
          {i < steps.length - 1 && (
            <span
              className={cn("absolute top-5 left-[calc(50%+26px)] hidden h-0.5 w-[calc(100%-52px)] rounded sm:block", state === "done" ? "bg-blue-500" : "bg-line")}
              aria-hidden
            />
          )}
          <PathStep href={state === "locked" ? null : href}>
            <span
              className={cn(
                "relative flex size-10 shrink-0 items-center justify-center rounded-xl",
                state === "done" && "bg-blue-600 text-white",
                state === "current" && "bg-white text-blue-600 ring-2 ring-blue-500 shadow-glow",
                state === "upcoming" && "bg-blue-50 text-blue-500 ring-1 ring-blue-100",
                state === "locked" && "bg-slate-100 text-slate-400",
              )}
            >
              {state === "done" ? <Check className="size-5" /> : <Icon className="size-[18px]" />}
              {state === "locked" && (
                <Lock className="absolute -right-1 -bottom-1 size-4 rounded-full bg-white p-0.5 text-slate-400 ring-1 ring-line" />
              )}
            </span>
            <div className="min-w-0">
              <p className={cn("text-sm font-semibold", state === "locked" ? "text-slate-400" : "text-ink")}>{label}</p>
              <p className="text-xs text-muted">{state === "locked" ? (lockedHint ?? "Coming soon") : detail}</p>
            </div>
          </PathStep>
        </li>
      ))}
    </ol>
  );
}

/** The concept map built by the knowledge pipeline — each concept is one click away from a Tutor question. */
function KeyConcepts({ projectId, concepts }: { projectId: string; concepts: Concept[] }) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {concepts.slice(0, 8).map((c) => (
        <li key={c.id} className="rounded-xl border border-line p-3 transition-colors hover:border-blue-200 hover:bg-blue-50/40">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink">{c.name}</p>
            {c.mastery != null ? (
              <span className="shrink-0" title={`Mastery from ${pluralize(c.evidenceCount, "quiz answer")}`}>
                <MasteryBadge band={c.masteryBand} className="tabular-nums" />
              </span>
            ) : (
              <span className="flex shrink-0 gap-0.5 pt-1" title={`Importance ${Math.round(c.importance * 5)}/5`}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className={cn("h-1.5 w-2.5 rounded-full", i < Math.round(c.importance * 5) ? "bg-blue-500" : "bg-slate-200")} />
                ))}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{c.description}</p>
          {c.mastery != null && (
            <div className="mt-2 flex items-center gap-2">
              <MasteryBar value={c.mastery} className="flex-1" />
              <span className="text-xs font-medium text-ink tabular-nums">{pct(c.mastery)}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted">
              {c.sources[0] ? `${c.sources[0].materialTitle} · p. ${c.sources[0].pages.slice(0, 3).join(", ")}` : ""}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <Link href={`/projects/${projectId}/quiz?focus=${c.id}&count=5`} className="font-medium text-blue-700 hover:underline">
                Practise
              </Link>
              <Link href={`/projects/${projectId}/tutor?ask=${encodeURIComponent(`Explain ${c.name}`)}`} className="font-medium text-blue-700 hover:underline">
                Ask Zoya →
              </Link>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "How well am I learning it?" — mastery with its coverage, and the way into practice. */
function LearningProgress({ projectId, learning }: { projectId: string; learning: ProjectDashboard["learning"] }) {
  const assessed = learning.mastery.assessedConcepts > 0;
  return (
    <Card>
      <CardHeader
        title="Learning progress"
        description={assessed ? "Estimated from your quiz answers" : "Take a quiz to measure what you know"}
        icon={<TrendingUp />}
      />
      <CardBody className="space-y-3">
        <MasteryOverview summary={learning.mastery} />
        <p className="text-xs text-muted">
          {pluralize(learning.quizzesCompleted, "quiz", "quizzes")} completed · {pluralize(learning.questionsAnswered, "graded answer")}
          {learning.accuracy != null && <> · {pct(learning.accuracy)} correct</>}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href={learning.activeQuiz ? `/projects/${projectId}/quiz/${learning.activeQuiz.id}` : `/projects/${projectId}/quiz`}
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-600"
          >
            {learning.activeQuiz ? "Resume your quiz" : assessed ? "Practise" : "Take a quiz"} <ArrowRight className="size-3.5" />
          </Link>
          {assessed && (
            <Link href={`/projects/${projectId}/growth`} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-600">
              See your growth <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

export default function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data } = useProject(projectId); // loaded (and error-handled) by the layout
  const ready = data?.stats.materialsByStatus.ready ?? 0;
  const concepts = useConcepts(projectId, ready > 0);
  const recommendations = useRecommendations(projectId, Boolean(data));
  if (!data) return null;

  const { project, stats, learning, recentMaterials, recentActivity, nextStep } = data;
  const pending = stats.materialsByStatus.queued + stats.materialsByStatus.processing;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Learning path" description="Materials → Tutor → Quiz → Growth → Analytics" />
        <CardBody>
          <LearningPath projectId={project.id} materialCount={stats.materialCount} pending={pending} ready={ready} learning={learning} />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {recommendations.data && recommendations.data.items.length > 0 ? (
            <Card>
              <CardHeader
                title="What to do next"
                description="Recommended from your mastery, recent mistakes and activity"
                icon={<Sparkles />}
                action={
                  <Link href={`/projects/${project.id}/growth`} className="text-sm font-medium text-blue-700 hover:text-blue-600">
                    Growth
                  </Link>
                }
              />
              <CardBody>
                <RecommendationList projectId={project.id} items={recommendations.data.items} />
              </CardBody>
            </Card>
          ) : (
            <NextStepCard step={nextStep} />
          )}

          {ready > 0 && (
            <Card>
              <CardHeader
                title="Key concepts"
                description={concepts.data ? `${pluralize(concepts.data.length, "concept")} extracted from your materials` : "Extracted from your materials"}
                icon={<Lightbulb />}
                action={
                  <Link href={`/projects/${project.id}/tutor`} className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-600">
                    <ZoyaAvatar size={22} /> Ask Zoya
                  </Link>
                }
              />
              <CardBody>
                {concepts.isLoading ? (
                  <p className="text-sm text-muted">Loading concepts…</p>
                ) : concepts.data && concepts.data.length > 0 ? (
                  <KeyConcepts projectId={project.id} concepts={concepts.data} />
                ) : (
                  <p className="text-sm text-muted">No concepts were extracted yet.</p>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Recent materials"
              action={
                <Link href={`/projects/${project.id}/materials`} className="text-sm font-medium text-blue-700 hover:text-blue-600">
                  Manage
                </Link>
              }
            />
            <CardBody>
              {recentMaterials.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Upload />}
                  title="No materials yet"
                  description="Upload PDFs to ground your Tutor and quizzes in your own content."
                  action={
                    <Link href={`/projects/${project.id}/materials`} className={buttonClasses("primary", "sm")}>
                      Upload material
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-line">
                  {recentMaterials.map((material) => (
                    <li key={material.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500">
                        <FileText className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{material.title}</p>
                        <p className="text-xs text-muted">
                          {formatBytes(material.sizeBytes)} · uploaded {timeAgo(material.createdAt)}
                        </p>
                      </div>
                      <MaterialStatusBadge status={material.status} error={material.processing.error?.message} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="About this project" />
            <CardBody className="space-y-3 text-sm leading-relaxed text-ink-soft">
              <p className="whitespace-pre-line">{project.description}</p>
              <p className="text-xs text-muted">
                Created {timeAgo(project.createdAt)} · last active {timeAgo(project.lastActivityAt)}
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          {ready > 0 && <LearningProgress projectId={project.id} learning={learning} />}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 xl:grid-cols-2">
            <StatCard label="Materials" value={formatNumber(stats.materialCount)} icon={<FileText />} tone="cyan" />
            <StatCard label="Pending" value={formatNumber(pending)} icon={<Clock />} tone="amber" />
            <StatCard label="Ready" value={formatNumber(stats.materialsByStatus.ready)} icon={<Check />} tone="emerald" />
            <StatCard label="Size" value={formatBytes(stats.totalBytes)} icon={<HardDrive />} tone="violet" />
          </div>
          <Card>
            <CardHeader title="Recent activity" />
            <CardBody className="pt-3">
              <ActivityFeed events={recentActivity} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
