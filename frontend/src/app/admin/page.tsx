"use client";

import { Activity, FileText, FolderKanban, HardDrive, Layers, RefreshCw, ShieldCheck, UserCheck, Users } from "lucide-react";
import Link from "next/link";
import { ACTIVITY_TYPE_LABELS } from "@/components/activity-feed";
import { ActivityChart, BarList } from "@/components/admin/activity-chart";
import { AdminActivityList } from "@/components/admin/admin-activity";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Avatar, PageHeader, StatCard } from "@/components/ui/misc";
import { formatBytes, formatNumber, timeAgo } from "@/lib/format";
import { useAdminOverview } from "@/lib/queries";

export default function AdminOverviewPage() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useAdminOverview();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const { kpis } = data;
  const pending = kpis.materialsByStatus.queued + kpis.materialsByStatus.processing;

  return (
    <div className="animate-rise">
      <PageHeader
        title="Platform overview"
        description="Users, learning activity and content across the whole platform."
        actions={
          <>
            <span className="text-xs text-muted">Updated {timeAgo(new Date(dataUpdatedAt))}</span>
            <Button variant="secondary" size="sm" onClick={() => refetch()} loading={isFetching}>
              {!isFetching && <RefreshCw className="size-3.5" />} Refresh
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Learners" value={formatNumber(kpis.learners)} icon={<Users />} tone="blue" hint={`+${kpis.newLearners7d} in the last 7 days`} />
        <StatCard label="Active learners (7d)" value={formatNumber(kpis.activeLearners7d)} icon={<UserCheck />} tone="emerald" hint={kpis.learners ? `${Math.round((kpis.activeLearners7d / kpis.learners) * 100)}% of learners` : undefined} />
        <StatCard label="Events (24h)" value={formatNumber(kpis.events24h)} icon={<Activity />} tone="indigo" />
        <StatCard label="Admins" value={formatNumber(kpis.admins)} icon={<ShieldCheck />} tone="violet" />
        <StatCard label="Spaces" value={formatNumber(kpis.spaces)} icon={<Layers />} tone="blue" />
        <StatCard label="Projects" value={formatNumber(kpis.projects)} icon={<FolderKanban />} tone="indigo" />
        <StatCard label="Materials" value={formatNumber(kpis.materials)} icon={<FileText />} tone="cyan" hint={pending > 0 ? `${pending} awaiting processing` : "None pending"} />
        <StatCard label="Storage used" value={formatBytes(kpis.storageBytes)} icon={<HardDrive />} tone="amber" hint="PDFs in GridFS" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Platform activity" description="Events per day, last 14 days (UTC). Hover a day for active users and sign-ups." />
          <CardBody>
            <ActivityChart data={data.activitySeries} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top activity types" description="Last 7 days" />
          <CardBody>
            <BarList
              items={data.topEventTypes.map((t) => ({ label: ACTIVITY_TYPE_LABELS[t.type] ?? t.type, value: t.count }))}
              emptyLabel="No activity in the last 7 days"
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Newest learners"
            action={
              <Link href="/admin/users" className="text-sm font-medium text-blue-700 hover:text-blue-600">
                All users
              </Link>
            }
          />
          <CardBody>
            {data.recentUsers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No learners yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.recentUsers.map((user) => (
                  <li key={user.id}>
                    <Link href={`/admin/users/${user.id}`} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-slate-50">
                      <Avatar name={user.name} size="sm" className="ring-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{user.name}</p>
                        <p className="truncate text-xs text-muted">{user.email}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted">{timeAgo(user.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Latest activity"
            action={
              <Link href="/admin/activity" className="text-sm font-medium text-blue-700 hover:text-blue-600">
                View all
              </Link>
            }
          />
          <CardBody>
            <AdminActivityList events={data.recentActivity} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
