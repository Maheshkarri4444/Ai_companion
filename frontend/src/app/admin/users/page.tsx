"use client";

import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { FilterBar, SearchInput, Table, Td, Th, EmptyRow, useUrlFilters } from "@/components/admin/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { Avatar, PageHeader, Pagination } from "@/components/ui/misc";
import { formatBytes, formatDate, formatNumber, timeAgo } from "@/lib/format";
import { useAdminUsers } from "@/lib/queries";
import { cn } from "@/lib/utils";

const LIMIT = 20;

function UsersView() {
  const router = useRouter();
  const [filters, setFilters] = useUrlFilters({ search: "", role: "", page: "1" });
  const page = Number(filters.page) || 1;
  const { data, isLoading, error, refetch, isPlaceholderData } = useAdminUsers({
    search: filters.search,
    role: filters.role,
    page,
    limit: LIMIT,
  });

  return (
    <div className="animate-rise">
      <PageHeader title="Users" description="Everyone on the platform, with their learning footprint." />
      <FilterBar>
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Search name or email" />
        <Select value={filters.role} onChange={(e) => setFilters({ role: e.target.value })} className="sm:w-44" aria-label="Role">
          <option value="">All roles</option>
          <option value="user">Learners</option>
          <option value="admin">Admins</option>
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
                  <Th>User</Th>
                  <Th>Role</Th>
                  <Th className="text-right">Spaces</Th>
                  <Th className="text-right">Projects</Th>
                  <Th className="text-right">Materials</Th>
                  <Th className="text-right">Storage</Th>
                  <Th>Joined</Th>
                  <Th>Last active</Th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <Td colSpan={8}>
                        <Skeleton className="h-8" />
                      </Td>
                    </tr>
                  ))
                ) : data && data.items.length > 0 ? (
                  data.items.map((user) => (
                    <tr
                      key={user.id}
                      onClick={() => router.push(`/admin/users/${user.id}`)}
                      className="cursor-pointer transition-colors hover:bg-blue-50/40"
                    >
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={user.name} size="sm" className="ring-0" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">{user.name}</p>
                            <p className="truncate text-xs text-muted">{user.email}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <div className="flex gap-1.5">
                          <Badge tone={user.role === "admin" ? "indigo" : "slate"}>{user.role === "admin" ? "Admin" : "Learner"}</Badge>
                          {user.status === "disabled" && <Badge tone="red">Disabled</Badge>}
                        </div>
                      </Td>
                      <Td className="text-right tabular-nums">{formatNumber(user.counts.spaces)}</Td>
                      <Td className="text-right tabular-nums">{formatNumber(user.counts.projects)}</Td>
                      <Td className="text-right tabular-nums">{formatNumber(user.counts.materials)}</Td>
                      <Td className="text-right whitespace-nowrap tabular-nums">{formatBytes(user.counts.storageBytes)}</Td>
                      <Td className="whitespace-nowrap">{formatDate(user.createdAt)}</Td>
                      <Td className="whitespace-nowrap">{timeAgo(user.lastActiveAt)}</Td>
                    </tr>
                  ))
                ) : (
                  <EmptyRow colSpan={8}>No users match these filters.</EmptyRow>
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

export default function AdminUsersPage() {
  return (
    <Suspense>
      <UsersView />
    </Suspense>
  );
}
