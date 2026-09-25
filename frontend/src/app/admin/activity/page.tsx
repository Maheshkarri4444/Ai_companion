"use client";

import { FilterX } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ACTIVITY_TYPE_LABELS, describeActivity } from "@/components/activity-feed";
import { ProjectFilter, SpaceFilter, UserFilter } from "@/components/admin/filters";
import { EmptyRow, FilterBar, Table, Td, Th, useUrlFilters } from "@/components/admin/table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { Avatar, PageHeader, Pagination } from "@/components/ui/misc";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useAdminActivity, useAdminActivityTypes } from "@/lib/queries";
import type { ActivityType } from "@/lib/types";
import { cn } from "@/lib/utils";

const LIMIT = 25;
const PERIODS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, all: 0 } as const;
type Period = keyof typeof PERIODS;

const DEFAULTS = { userId: "", spaceId: "", projectId: "", type: "", period: "7d", page: "1" };

/** Lower bound for the period, rounded to the minute so the query key stays stable between renders. */
function periodStart(period: string): string | undefined {
  const days = PERIODS[period as Period];
  if (!days) return undefined;
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  return new Date(minute - days * 24 * 60 * 60 * 1000).toISOString();
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function ActivityView() {
  const [filters, setFilters] = useUrlFilters(DEFAULTS);
  const page = Number(filters.page) || 1;
  const { data: types } = useAdminActivityTypes();
  const { data, isLoading, error, refetch, isPlaceholderData } = useAdminActivity({
    userId: filters.userId,
    spaceId: filters.spaceId,
    projectId: filters.projectId,
    type: filters.type,
    from: periodStart(filters.period),
    page,
    limit: LIMIT,
  });
  const filtered = Object.entries(DEFAULTS).some(([k, v]) => k !== "page" && filters[k as keyof typeof DEFAULTS] !== v);

  return (
    <div className="animate-rise">
      <PageHeader title="Activity" description="Platform-wide learning activity. Filter by user, Space, Project, activity type or time period." />
      <FilterBar>
        <Select value={filters.period} onChange={(e) => setFilters({ period: e.target.value })} className="sm:w-40" aria-label="Time period">
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </Select>
        <UserFilter value={filters.userId} onChange={(userId) => setFilters({ userId, spaceId: "", projectId: "" })} />
        <SpaceFilter userId={filters.userId} value={filters.spaceId} onChange={(spaceId) => setFilters({ spaceId, projectId: "" })} />
        <ProjectFilter userId={filters.userId} spaceId={filters.spaceId} value={filters.projectId} onChange={(projectId) => setFilters({ projectId })} />
        <Select value={filters.type} onChange={(e) => setFilters({ type: e.target.value })} className="sm:w-48" aria-label="Activity type">
          <option value="">All activity types</option>
          {(types?.items ?? []).map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_TYPE_LABELS[t as ActivityType] ?? t}
            </option>
          ))}
        </Select>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({ ...DEFAULTS })}>
            <FilterX className="size-4" /> Reset
          </Button>
        )}
      </FilterBar>

      <Card className="overflow-hidden">
        {error ? (
          <div className="p-5">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        ) : (
          <>
            <Table className={cn(isPlaceholderData && "opacity-60 transition-opacity")}>
              <thead>
                <tr>
                  <Th className="w-40">When</Th>
                  <Th>User</Th>
                  <Th>Activity</Th>
                  <Th>Context</Th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <Td colSpan={4}>
                      <Skeleton className="h-32" />
                    </Td>
                  </tr>
                ) : data && data.items.length > 0 ? (
                  data.items.map((event) => {
                    const { Icon, tone, text } = describeActivity(event);
                    const context = [str(event.metadata.projectName), str(event.metadata.spaceName)].filter(Boolean).join(" · ");
                    return (
                      <tr key={event.id} className="hover:bg-slate-50/60">
                        <Td className="whitespace-nowrap">
                          <p className="text-ink">{timeAgo(event.createdAt)}</p>
                          <p className="text-xs text-muted">{formatDateTime(event.createdAt)}</p>
                        </Td>
                        <Td>
                          {event.user ? (
                            <Link href={`/admin/users/${event.user.id}`} className="flex items-center gap-2 hover:text-blue-700">
                              <Avatar name={event.user.name} size="sm" className="ring-0" />
                              <span className="max-w-40 truncate font-medium text-ink">{event.user.name}</span>
                            </Link>
                          ) : (
                            <span className="text-muted">Deleted user</span>
                          )}
                        </Td>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", tone)}>
                              <Icon className="size-3.5" />
                            </span>
                            <span className="text-ink-soft">{text}</span>
                          </div>
                        </Td>
                        <Td className="max-w-56 truncate text-xs text-muted">{context || "—"}</Td>
                      </tr>
                    );
                  })
                ) : (
                  <EmptyRow colSpan={4}>No activity for these filters.</EmptyRow>
                )}
              </tbody>
            </Table>
            {data && <Pagination page={page} limit={LIMIT} total={data.total} onPageChange={(p) => setFilters({ page: String(p) })} />}
          </>
        )}
      </Card>
    </div>
  );
}

export default function AdminActivityPage() {
  return (
    <Suspense>
      <ActivityView />
    </Suspense>
  );
}
