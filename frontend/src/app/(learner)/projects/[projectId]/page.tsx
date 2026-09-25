"use client";

import { Check, ChartColumn, Clock, FileText, HardDrive, ListChecks, Lock, MessageSquare, TrendingUp, Upload, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ActivityFeed } from "@/components/activity-feed";
import { NextStepCard } from "@/components/next-step-card";
import { MaterialStatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { StatCard } from "@/components/ui/misc";
import { formatBytes, formatNumber, timeAgo } from "@/lib/format";
import { useProject } from "@/lib/queries";
import { cn } from "@/lib/utils";

type StepState = "done" | "current" | "locked";

function LearningPath({ materialCount, pending }: { materialCount: number; pending: number }) {
  const steps: Array<{ label: string; detail: string; icon: LucideIcon; state: StepState }> = [
    {
      label: "Materials",
      detail: materialCount === 0 ? "Upload your PDFs" : pending > 0 ? `${pending} awaiting processing` : `${materialCount} added`,
      icon: FileText,
      state: materialCount > 0 ? "done" : "current",
    },
    { label: "AI Tutor", detail: "Grounded, cited answers", icon: MessageSquare, state: "locked" },
    { label: "Quiz", detail: "Adaptive practice", icon: ListChecks, state: "locked" },
    { label: "Growth", detail: "Concept mastery", icon: TrendingUp, state: "locked" },
    { label: "Analytics", detail: "Progress over time", icon: ChartColumn, state: "locked" },
  ];

  return (
    <ol className="grid gap-3 sm:grid-cols-5">
      {steps.map(({ label, detail, icon: Icon, state }, i) => (
        <li key={label} className="relative">
          {i < steps.length - 1 && (
            <span
              className={cn("absolute top-5 left-[calc(50%+26px)] hidden h-0.5 w-[calc(100%-52px)] rounded sm:block", state === "done" ? "bg-blue-500" : "bg-line")}
              aria-hidden
            />
          )}
          <div className="flex items-center gap-3 sm:flex-col sm:text-center">
            <span
              className={cn(
                "relative flex size-10 shrink-0 items-center justify-center rounded-xl",
                state === "done" && "bg-blue-600 text-white",
                state === "current" && "bg-white text-blue-600 ring-2 ring-blue-500 shadow-glow",
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
              <p className="text-xs text-muted">{state === "locked" ? "Coming soon" : detail}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data } = useProject(projectId); // loaded (and error-handled) by the layout
  if (!data) return null;

  const { project, stats, recentMaterials, recentActivity, nextStep } = data;
  const pending = stats.materialsByStatus.queued + stats.materialsByStatus.processing;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Learning path" description="Materials → Tutor → Quiz → Growth → Analytics" />
        <CardBody>
          <LearningPath materialCount={stats.materialCount} pending={pending} />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <NextStepCard step={nextStep} />

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
