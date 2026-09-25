"use client";

import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { UserFilter } from "@/components/admin/filters";
import { EmptyRow, FilterBar, SearchInput, Table, Td, Th, useUrlFilters } from "@/components/admin/table";
import { MaterialStatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { PageHeader, Pagination } from "@/components/ui/misc";
import { formatBytes, formatDateTime, timeAgo } from "@/lib/format";
import { useAdminMaterials } from "@/lib/queries";
import { cn } from "@/lib/utils";

const LIMIT = 20;

function MaterialsView() {
  const [filters, setFilters] = useUrlFilters({ search: "", userId: "", status: "", page: "1" });
  const page = Number(filters.page) || 1;
  const { data, isLoading, error, refetch, isPlaceholderData } = useAdminMaterials({
    search: filters.search,
    userId: filters.userId,
    status: filters.status,
    page,
    limit: LIMIT,
  });

  return (
    <div className="animate-rise">
      <PageHeader
        title="Materials"
        description="Uploaded learning material and its processing state. Opening a learner's PDF is recorded in the audit log."
      />
      <FilterBar>
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Search title or filename" />
        <UserFilter value={filters.userId} onChange={(userId) => setFilters({ userId })} />
        <Select value={filters.status} onChange={(e) => setFilters({ status: e.target.value })} className="sm:w-44" aria-label="Status">
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="processing">Processing</option>
          <option value="ready">Ready</option>
          <option value="failed">Failed</option>
        </Select>
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
                  <Th>Material</Th>
                  <Th>Project · Space</Th>
                  <Th>Owner</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Size</Th>
                  <Th>Uploaded</Th>
                  <Th className="text-right">File</Th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <Td colSpan={7}>
                      <Skeleton className="h-24" />
                    </Td>
                  </tr>
                ) : data && data.items.length > 0 ? (
                  data.items.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/60">
                      <Td>
                        <div className="flex items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500">
                            <FileText className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="max-w-60 truncate font-medium text-ink">{m.title}</p>
                            <p className="max-w-60 truncate text-xs text-muted">{m.originalFilename}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <p className="max-w-44 truncate text-ink">{m.project.name ?? "—"}</p>
                        <p className="max-w-44 truncate text-xs text-muted">{m.space.name ?? "—"}</p>
                      </Td>
                      <Td>
                        {m.owner ? (
                          <Link href={`/admin/users/${m.owner.id}`} className="font-medium whitespace-nowrap text-ink hover:text-blue-700">
                            {m.owner.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        <MaterialStatusBadge status={m.status} error={m.processing.error?.message} />
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular-nums">{formatBytes(m.sizeBytes)}</Td>
                      <Td className="whitespace-nowrap" title={formatDateTime(m.createdAt)}>
                        {timeAgo(m.createdAt)}
                      </Td>
                      <Td className="text-right">
                        <a
                          href={`/api/admin/materials/${m.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-600"
                        >
                          View <ExternalLink className="size-3.5" />
                        </a>
                      </Td>
                    </tr>
                  ))
                ) : (
                  <EmptyRow colSpan={7}>No materials match these filters.</EmptyRow>
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

export default function AdminMaterialsPage() {
  return (
    <Suspense>
      <MaterialsView />
    </Suspense>
  );
}
