"use client";

import { ArrowRight, Bot, CalendarDays, Clock, ExternalLink, FileText, FolderKanban, GraduationCap, HardDrive, Layers, ListChecks, LogIn, Target, TrendingUp, UserX } from "lucide-react";
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

  const { user, stats, spaces, materials, recentActivity, aiUsage, assessments, growth } = data;
  const pctOf = (value: number | null) => (value == null ? "—" : `${Math.round(value * 100)}%`);

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

      <Card>
        <CardHeader
          title="Assessments & mastery"
          description="Adaptive quiz results and the concept mastery estimated from this learner's answers"
          icon={<GraduationCap />}
        />
        <CardBody className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-6">
            {(
              [
                ["Quizzes completed", formatNumber(assessments.quizzesCompleted)],
                ["In progress", formatNumber(assessments.quizzesActive)],
                ["Answers", formatNumber(assessments.questionsAnswered)],
                ["Accuracy", pctOf(assessments.accuracy)],
                ["Average score", pctOf(assessments.avgScore)],
                ["Grading pending / failed", `${assessments.grading.pending} / ${assessments.grading.failed}`],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 text-lg font-semibold text-ink tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2 text-xs">
            {assessments.byType.map((t) => (
              <Badge key={t.type} tone="slate">
                {t.type === "mcq" ? "Multiple choice" : "Written"} · {formatNumber(t.answered)} answered · avg {pctOf(t.avgScore)}
              </Badge>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Mastery by project</p>
              {assessments.mastery.length === 0 ? (
                <p className="text-sm text-muted">No concepts yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {assessments.mastery.map((m) => (
                    <li key={m.projectId} className="rounded-xl border border-line px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-medium text-ink">{m.projectName}</span>
                        <span className="shrink-0 text-muted tabular-nums">
                          <span className="font-semibold text-ink">{pctOf(m.overallMastery)}</span> · {m.assessedConcepts}/{m.totalConcepts} assessed
                        </span>
                      </div>
                      {m.weakest.length > 0 && (
                        <p className="mt-1 truncate text-xs text-muted">
                          Weakest: {m.weakest.map((w) => `${w.name} (${pctOf(w.mastery)})`).join(", ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Recent quizzes</p>
              {assessments.recentQuizzes.length === 0 ? (
                <p className="text-sm text-muted">No completed quizzes yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {assessments.recentQuizzes.map((q) => (
                    <li key={q.id} className="flex items-start justify-between gap-3 py-2 text-sm first:pt-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{q.projectName ?? "Deleted project"}</p>
                        <p className="truncate text-xs text-muted">
                          {q.mode} · {formatDateTime(q.completedAt)}
                          {q.needsWork.length > 0 && <> · needs work: {q.needsWork.slice(0, 2).join(", ")}</>}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        <span className="font-semibold text-ink">
                          {q.correct}/{q.answered}
                        </span>{" "}
                        · avg {pctOf(q.avgScore)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Growth & recommendations"
          description="Learning streak, concept trends over the last 7 days, and how this learner responds to recommendations"
          icon={<TrendingUp />}
        />
        <CardBody className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-6">
            {(
              [
                ["Current streak", `${growth.streak.current} day${growth.streak.current === 1 ? "" : "s"}`],
                ["Longest streak", `${growth.streak.longest} day${growth.streak.longest === 1 ? "" : "s"}`],
                ["Active days (30d)", formatNumber(growth.activeDays30)],
                ["Recommendations", formatNumber(growth.recommendations.generated)],
                ["Followed", `${formatNumber(growth.recommendations.completed)} · ${pctOf(growth.recommendations.actRate)}`],
                ["Dismissed / expired", `${growth.recommendations.dismissed} / ${growth.recommendations.expired}`],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 text-lg font-semibold text-ink tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Concept trends by project (7 days)</p>
              {growth.projects.length === 0 ? (
                <p className="text-sm text-muted">No assessed concepts yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {growth.projects.map((p) => (
                    <li key={p.projectId} className="rounded-xl border border-line px-3 py-2.5">
                      <p className="truncate text-sm font-medium text-ink">{p.projectName}</p>
                      <p className="mt-0.5 text-xs text-muted tabular-nums">
                        <span className="font-semibold text-emerald-700">{p.counts.improving} improving</span> ·{" "}
                        <span className="font-semibold text-rose-700">{p.counts.attention} need attention</span> · {p.counts.stable} stable
                        {p.overallChange !== null && (
                          <>
                            {" "}
                            · overall {p.overallChange >= 0 ? "+" : ""}
                            {Math.round(p.overallChange * 100)} pts
                          </>
                        )}
                      </p>
                      {p.attention.length > 0 && (
                        <p className="mt-1 text-xs text-muted">
                          Needs attention: {p.attention.map((a) => `${a.name} (${pctOf(a.mastery)}${a.reasons[0] ? `, ${a.reasons[0]}` : ""})`).join(" · ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Active recommendations</p>
              {growth.recommendations.active.length === 0 ? (
                <p className="text-sm text-muted">No active recommendations.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {growth.recommendations.active.map((r) => (
                    <li key={r.id} className="py-2 text-sm first:pt-0">
                      <p className="font-medium text-ink">{r.title}</p>
                      <p className="text-xs text-muted">
                        {r.projectName ?? "Deleted project"} · {r.kind.replace(/_/g, " ")} · {r.source === "ai" ? "AI-phrased" : "template"} · {timeAgo(r.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
