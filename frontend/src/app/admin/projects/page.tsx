"use client";

import Link from "next/link";
import { Suspense } from "react";
import { SpaceFilter, UserFilter } from "@/components/admin/filters";
import { EmptyRow, FilterBar, SearchInput, Table, Td, Th, useUrlFilters } from "@/components/admin/table";
import { SpaceTile } from "@/components/space-visuals";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader, Pagination } from "@/components/ui/misc";
import { MaterialStatusBar } from "@/components/workspace-cards";
import { formatDate, pluralize, timeAgo } from "@/lib/format";
import { useAdminProjects } from "@/lib/queries";
import { cn } from "@/lib/utils";

const LIMIT = 20;

function ProjectsView() {
  const [filters, setFilters] = useUrlFilters({ search: "", userId: "", spaceId: "", page: "1" });
  const page = Number(filters.page) || 1;
  const { data, isLoading, error, refetch, isPlaceholderData } = useAdminProjects({
    search: filters.search,
    userId: filters.userId,
    spaceId: filters.spaceId,
    page,
    limit: LIMIT,
  });

  return (
    <div className="animate-rise">
      <PageHeader title="Projects" description="Focused learning journeys across all Spaces." />
      <FilterBar>
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Search name, description or goal" />
        <UserFilter value={filters.userId} onChange={(userId) => setFilters({ userId, spaceId: "" })} />
        <SpaceFilter userId={filters.userId} value={filters.spaceId} onChange={(spaceId) => setFilters({ spaceId })} />
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
                  <Th>Project</Th>
                  <Th>Space</Th>
                  <Th>Owner</Th>
                  <Th>Materials</Th>
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
                  data.items.map((project) => (
                    <tr key={project.id} className="hover:bg-slate-50/60">
                      <Td>
                        <p className="max-w-64 truncate font-medium text-ink">{project.name}</p>
                        <p className="max-w-64 truncate text-xs text-muted" title={project.learningGoal}>
                          Goal: {project.learningGoal}
                        </p>
                      </Td>
                      <Td>
                        {project.space ? (
                          <span className="flex items-center gap-2">
                            <SpaceTile color={project.space.color} icon={project.space.icon} size="sm" className="size-6 rounded-md [&>svg]:size-3" />
                            <span className="max-w-36 truncate">{project.space.name}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        {project.owner ? (
                          <Link href={`/admin/users/${project.owner.id}`} className="font-medium whitespace-nowrap text-ink hover:text-blue-700">
                            {project.owner.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        <div className="w-32 space-y-1">
                          <MaterialStatusBar counts={project.materialStatusCounts} />
                          <p className="text-xs text-muted">{pluralize(project.materialCount, "material")}</p>
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(project.createdAt)}</Td>
                      <Td className="whitespace-nowrap">{timeAgo(project.lastActivityAt)}</Td>
                    </tr>
                  ))
                ) : (
                  <EmptyRow colSpan={6}>No projects match these filters.</EmptyRow>
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

export default function AdminProjectsPage() {
  return (
    <Suspense>
      <ProjectsView />
    </Suspense>
  );
}
