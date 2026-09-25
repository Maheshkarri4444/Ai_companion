"use client";

import { ArrowRight, FileText, FolderKanban, HardDrive, Layers, LineChart, Lock, Plus, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { ActivityFeed } from "@/components/activity-feed";
import { NextStepCard } from "@/components/next-step-card";
import { SpaceTile } from "@/components/space-visuals";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { StatCard } from "@/components/ui/misc";
import { MaterialStatusBar, ProjectCard } from "@/components/workspace-cards";
import { formatBytes, formatNumber, greeting, pluralize, timeAgo } from "@/lib/format";
import { useDashboard, useMe } from "@/lib/queries";

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-44 rounded-3xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data, isLoading, error, refetch } = useDashboard();

  if (isLoading) return <DashboardSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const firstName = me?.name.split(" ")[0] ?? "there";
  const { stats, continueLearning, recentProjects, recentActivity, nextStep } = data;
  const pending = stats.materialsByStatus.queued + stats.materialsByStatus.processing;

  return (
    <div className="space-y-6 animate-rise">
      <section className="relative overflow-hidden rounded-3xl bg-ai-hero p-6 text-white shadow-lift sm:p-8">
        <div className="bg-ai-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative space-y-6">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-cyan-200/90">
              <Sparkles className="size-4" /> Your learning companion
            </p>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {greeting()}, {firstName}
            </h1>
            <p className="mt-1 text-blue-100/75">
              {continueLearning
                ? `You were last working on ${continueLearning.name}. Here's where things stand.`
                : "Let's set up your first learning journey."}
            </p>
          </div>
          <NextStepCard step={nextStep} variant="hero" />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Spaces" value={formatNumber(stats.spaceCount)} icon={<Layers />} tone="blue" />
        <StatCard label="Projects" value={formatNumber(stats.projectCount)} icon={<FolderKanban />} tone="indigo" />
        <StatCard
          label="Materials"
          value={formatNumber(stats.materialCount)}
          icon={<FileText />}
          tone="cyan"
          hint={pending > 0 ? `${pending} queued for processing` : stats.materialCount > 0 ? "All processed" : "No PDFs yet"}
        />
        <StatCard label="Library size" value={formatBytes(stats.totalBytes)} icon={<HardDrive />} tone="violet" />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Continue learning" icon={<Target className="size-4" />} />
            <CardBody>
              {continueLearning ? (
                <div className="flex flex-col gap-4 rounded-xl border border-line bg-canvas/60 p-4 sm:flex-row sm:items-center">
                  {continueLearning.space && <SpaceTile color={continueLearning.space.color} icon={continueLearning.space.icon} size="lg" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-muted">{continueLearning.space?.name}</p>
                    <h3 className="font-display text-lg font-semibold text-ink">{continueLearning.name}</h3>
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted">{continueLearning.learningGoal}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <MaterialStatusBar counts={continueLearning.materialStatusCounts} className="w-40" />
                      <span className="text-xs text-muted">
                        {pluralize(continueLearning.materialCount, "material")} · active {timeAgo(continueLearning.lastActivityAt)}
                      </span>
                    </div>
                  </div>
                  <Link href={`/projects/${continueLearning.id}`} className={buttonClasses("primary", "md", "self-start sm:self-center")}>
                    Open <ArrowRight className="size-4" />
                  </Link>
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={<Layers />}
                  title="Nothing to continue yet"
                  description="Create a Space and a Project to start your first learning journey."
                  action={
                    <Link href="/spaces?new=1" className={buttonClasses("primary", "sm")}>
                      <Plus className="size-4" /> Create a Space
                    </Link>
                  }
                />
              )}
            </CardBody>
          </Card>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold text-ink">Recent projects</h2>
              <Link href="/spaces" className="text-sm font-medium text-blue-700 hover:text-blue-600">
                All spaces
              </Link>
            </div>
            {recentProjects.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line-strong bg-white/60 px-4 py-8 text-center text-sm text-muted">
                Your projects will appear here.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {recentProjects.slice(0, 4).map((project) => (
                  <ProjectCard key={project.id} project={project} showSpace />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title="Learning insights" icon={<LineChart className="size-4" />} />
            <CardBody>
              <div className="rounded-xl border border-dashed border-line-strong bg-canvas/60 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Lock className="size-4 text-blue-500" /> Unlocks as you learn
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Overall progress, areas needing attention and AI recommendations appear once you start learning with the
                  Tutor and quizzes.
                </p>
              </div>
            </CardBody>
          </Card>
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
