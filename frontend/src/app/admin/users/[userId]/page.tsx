"use client";

import { ArrowRight, Bot, CalendarDays, Clock, ExternalLink, FileText, FolderKanban, HardDrive, Layers, ListChecks, LogIn, Target, UserX } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ActivityFeed } from "@/components/activity-feed";
import { Table, Td, Th, EmptyRow } from "@/components/admin/table";
import { SpaceTile } from "@/components/space-visuals";
import { Badge, MaterialStatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Avatar, Breadcrumbs, StatCard } from "@/components/ui/misc";
import { MaterialStatusBar } from "@/components/workspace-cards";
import { ApiError } from "@/lib/api";
import { formatBytes, formatDate, formatDateTime, formatNumber, pluralize, timeAgo } from "@/lib/format";
import { useAdminUser } from "@/lib/queries";

export default function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { data, isLoading, error, refetch } = useAdminUser(userId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        icon={<UserX />}
        title="User not found"
        action={
          <Link href="/admin/users" className={buttonClasses("secondary", "sm")}>
            Back to users
          </Link>
        }
      />
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const { user, stats, spaces, materials, recentActivity, aiUsage } = data;

  return (
    <div className="animate-rise space-y-6">
      <Breadcrumbs items={[{ label: "Users", href: "/admin/users" }, { label: user.name }]} />

      <Card className="overflow-hidden">
        <div className="bg-ai-hero h-16" aria-hidden />
        <div className="px-6 pb-5">
          <Avatar name={user.name} size="lg" className="-mt-7 ring-4" />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-xl font-semibold text-ink">{user.name}</h1>
                <Badge tone={user.role === "admin" ? "indigo" : "slate"}>{user.role === "admin" ? "Admin" : "Learner"}</Badge>
                <Badge tone={user.status === "active" ? "green" : "red"}>{user.status === "active" ? "Active" : "Disabled"}</Badge>
              </div>
              <p className="text-sm text-muted">{user.email}</p>
            </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" /> Joined <dd className="font-medium text-ink-soft">{formatDate(user.createdAt)}</dd>
            </div>
            <div className="flex items-center gap-1.5" title={formatDateTime(user.lastLoginAt)}>
              <LogIn className="size-3.5" /> Last sign-in <dd className="font-medium text-ink-soft">{timeAgo(user.lastLoginAt)}</dd>
            </div>
            <div className="flex items-center gap-1.5" title={formatDateTime(user.lastActiveAt)}>
              <Clock className="size-3.5" /> Last active <dd className="font-medium text-ink-soft">{timeAgo(user.lastActiveAt)}</dd>
            </div>
          </dl>
          </div>
        </div>
      </Card>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Spaces" value={formatNumber(stats.spaceCount)} icon={<Layers />} tone="blue" />
        <StatCard label="Projects" value={formatNumber(stats.projectCount)} icon={<FolderKanban />} tone="indigo" />
        <StatCard label="Materials" value={formatNumber(stats.materialCount)} icon={<FileText />} tone="cyan" />
        <StatCard label="Storage" value={formatBytes(stats.totalBytes)} icon={<HardDrive />} tone="violet" />
        <StatCard label="Events" value={formatNumber(stats.eventCount)} icon={<ListChecks />} tone="emerald" />
      </section>

      <Card>
        <CardHeader
          title="AI usage & tutoring"
          description="Every AI call made on this learner's behalf, and how Zoya's answers were grounded"
          icon={<Bot />}
          action={
            <Link href={`/admin/ai-usage?userId=${user.id}`} className="text-sm font-medium text-blue-700 hover:text-blue-600">
              View calls
            </Link>
          }
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-6">
            {(
              [
                ["AI calls", formatNumber(aiUsage.calls)],
                ["Tokens", formatNumber(aiUsage.tokens)],
                ["Estimated cost", `$${aiUsage.costUsd.toFixed(4)}`],
                ["Tutor answers", formatNumber(aiUsage.tutorAnswers)],
                ["Conversations", formatNumber(stats.conversationCount)],
                ["Remembered items", formatNumber(stats.memoryCount)],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 text-lg font-semibold text-ink tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {Object.entries(aiUsage.grounding).map(([status, count]) => (
              <Badge key={status} tone={status === "grounded" ? "green" : status === "insufficient" ? "slate" : status === "partial" ? "amber" : "indigo"}>
                {status}: {count}
              </Badge>
            ))}
            {(aiUsage.feedback.up > 0 || aiUsage.feedback.down > 0) && (
              <Badge tone="indigo">
                feedback 👍 {aiUsage.feedback.up} · 👎 {aiUsage.feedback.down}
              </Badge>
            )}
            {aiUsage.byFeature.slice(0, 6).map((f) => (
              <Badge key={f.feature} tone="slate">
                {f.feature} · {f.calls}
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Learning journey" description="Spaces and the Projects inside them" />
          <CardBody className="space-y-4">
            {spaces.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">This learner hasn&apos;t created a Space yet.</p>
            ) : (
              spaces.map((space) => (
                <div key={space.id} className="rounded-xl border border-line">
                  <div className="flex items-center gap-3 border-b border-line bg-canvas/50 px-4 py-3">
                    <SpaceTile color={space.color} icon={space.icon} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{space.name}</p>
                      <p className="truncate text-xs text-muted">{space.description}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted">
                      {pluralize(space.projectCount, "project")} · {pluralize(space.materialCount, "material")}
                    </span>
                  </div>
                  {space.projects.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted">No projects yet.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {space.projects.map((project) => (
                        <li key={project.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">{project.name}</p>
                            <p className="flex items-start gap-1 text-xs text-muted">
                              <Target className="mt-px size-3 shrink-0 text-blue-500" />
                              <span className="line-clamp-1">{project.learningGoal}</span>
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
                            <MaterialStatusBar counts={project.materialStatusCounts} className="w-24" />
                            <span className="w-20">{pluralize(project.materialCount, "material")}</span>
                            <span className="w-24 text-right">active {timeAgo(project.lastActivityAt)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
            <p className="rounded-xl border border-dashed border-line-strong bg-canvas/50 px-4 py-3 text-xs text-muted">
              Assessments, concept mastery and AI usage for this learner appear here once those features are live.
            </p>
          </CardBody>
        </Card>

        <Card className="self-start">
          <CardHeader
            title="Recent activity"
            action={
              <Link href={`/admin/activity?userId=${user.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-600">
                All <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <CardBody className="pt-3">
            <ActivityFeed events={recentActivity.slice(0, 12)} linkify={false} />
          </CardBody>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Materials" description={`${pluralize(stats.materialCount, "document")} uploaded`} className="pb-4" />
        <Table>
          <thead>
            <tr>
              <Th>Material</Th>
              <Th>Project</Th>
              <Th>Status</Th>
              <Th className="text-right">Size</Th>
              <Th>Uploaded</Th>
              <Th className="text-right">File</Th>
            </tr>
          </thead>
          <tbody>
            {materials.length === 0 ? (
              <EmptyRow colSpan={6}>No materials uploaded.</EmptyRow>
            ) : (
              materials.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/60">
                  <Td>
                    <p className="max-w-72 truncate font-medium text-ink">{m.title}</p>
                    <p className="max-w-72 truncate text-xs text-muted">{m.originalFilename}</p>
                  </Td>
                  <Td>{m.projectName ?? "—"}</Td>
                  <Td>
                    <MaterialStatusBadge status={m.status} error={m.processing.error?.message} />
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular-nums">{formatBytes(m.sizeBytes)}</Td>
                  <Td className="whitespace-nowrap">{timeAgo(m.createdAt)}</Td>
                  <Td className="text-right">
                    <a
                      href={`/api/admin/materials/${m.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-600"
                      title="Opens the PDF (access is audit-logged)"
                    >
                      View <ExternalLink className="size-3.5" />
                    </a>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
