"use client";

import Link from "next/link";
import { Suspense } from "react";
import { UserFilter } from "@/components/admin/filters";
import { EmptyRow, FilterBar, SearchInput, Table, Td, Th, useUrlFilters } from "@/components/admin/table";
import { SpaceTile } from "@/components/space-visuals";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader, Pagination } from "@/components/ui/misc";
import { formatDate, formatNumber, timeAgo } from "@/lib/format";
import { useAdminSpaces } from "@/lib/queries";
import { cn } from "@/lib/utils";

const LIMIT = 20;

function SpacesView() {
  const [filters, setFilters] = useUrlFilters({ search: "", userId: "", page: "1" });
  const page = Number(filters.page) || 1;
  const { data, isLoading, error, refetch, isPlaceholderData } = useAdminSpaces({
    search: filters.search,
    userId: filters.userId,
    page,
    limit: LIMIT,
  });

  return (
    <div className="animate-rise">
      <PageHeader title="Spaces" description="Every learning Space on the platform." />
      <FilterBar>
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Search spaces" />
        <UserFilter value={filters.userId} onChange={(userId) => setFilters({ userId })} />
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
                  <Th>Space</Th>
                  <Th>Owner</Th>
                  <Th className="text-right">Projects</Th>
                  <Th className="text-right">Materials</Th>
                  <Th>Created</Th>
                  <Th>Last activity</Th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <Td colSpan={6}>
                      <Skeleton className="h-24" />
                    </Td>
                  </tr>
                ) : data && data.items.length > 0 ? (
                  data.items.map((space) => (
                    <tr key={space.id} className="hover:bg-slate-50/60">
                      <Td>
                        <div className="flex items-center gap-3">
                          <SpaceTile color={space.color} icon={space.icon} size="sm" />
                          <div className="min-w-0">
                            <p className="max-w-64 truncate font-medium text-ink">{space.name}</p>
                            <p className="max-w-64 truncate text-xs text-muted">{space.description}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        {space.owner ? (
                          <Link href={`/admin/users/${space.owner.id}`} className="hover:text-blue-700">
                            <p className="font-medium text-ink">{space.owner.name}</p>
                            <p className="text-xs text-muted">{space.owner.email}</p>
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">{formatNumber(space.projectCount)}</Td>
                      <Td className="text-right tabular-nums">{formatNumber(space.materialCount)}</Td>
                      <Td className="whitespace-nowrap">{formatDate(space.createdAt)}</Td>
                      <Td className="whitespace-nowrap">{timeAgo(space.lastActivityAt)}</Td>
                    </tr>
                  ))
                ) : (
                  <EmptyRow colSpan={6}>No spaces match these filters.</EmptyRow>
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

export default function AdminSpacesPage() {
  return (
    <Suspense>
      <SpacesView />
    </Suspense>
  );
}
