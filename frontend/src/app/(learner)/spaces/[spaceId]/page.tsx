"use client";

import { Clock, FileText, FolderKanban, FolderPlus, HardDrive, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { ActivityFeed } from "@/components/activity-feed";
import { LearningInsights } from "@/components/learning/learning-insights";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { SpaceFormDialog } from "@/components/spaces/space-form-dialog";
import { SpaceTile } from "@/components/space-visuals";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { ProjectCard } from "@/components/workspace-cards";
import { ApiError, errorMessage } from "@/lib/api";
import { formatBytes, formatNumber, pluralize } from "@/lib/format";
import { useDeleteSpace, useSpace } from "@/lib/queries";

function SpaceView() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, isLoading, error, refetch } = useSpace(spaceId);
  const deleteSpace = useDeleteSpace();
  const [projectFormOpenState, setProjectFormOpenState] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Deep link from "New project" CTAs (?newProject=1): derived from the URL, cleared on close.
  const deepLinked = searchParams.get("newProject") === "1";
  const projectFormOpen = projectFormOpenState || deepLinked;
  const setProjectFormOpen = (open: boolean) => {
    setProjectFormOpenState(open);
    if (!open && deepLinked) router.replace(`/spaces/${spaceId}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-2/3" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
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
        icon={<FolderKanban />}
        title="Space not found"
        description="It may have been deleted, or the link is wrong."
        action={
          <Link href="/spaces" className={buttonClasses("secondary", "sm")}>
            Back to spaces
          </Link>
        }
      />
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const { space, projects, stats, recentActivity } = data;
  const progressOf = new Map(data.projectProgress.map((p) => [p.projectId, p]));
  const pending = stats.materialsByStatus.queued + stats.materialsByStatus.processing;

  async function confirmDelete() {
    try {
      await deleteSpace.mutateAsync(space.id);
      toast.success(`Deleted “${space.name}”`);
      router.replace("/spaces");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        crumbs={[{ label: "Spaces", href: "/spaces" }, { label: space.name }]}
        icon={<SpaceTile color={space.color} icon={space.icon} size="lg" />}
        title={space.name}
        description={space.description}
        actions={
          <>
            <Button onClick={() => setProjectFormOpen(true)}>
              <Plus className="size-4" /> New project
            </Button>
            <Menu
              trigger={
                <Button variant="secondary" size="icon" aria-label="Space actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            >
              <MenuItem icon={<Pencil />} onSelect={() => setEditOpen(true)}>
                Edit space
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} onSelect={() => setDeleteOpen(true)} danger>
                Delete space
              </MenuItem>
            </Menu>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Projects" value={formatNumber(stats.projectCount)} icon={<FolderKanban />} tone="indigo" />
        <StatCard label="Materials" value={formatNumber(stats.materialCount)} icon={<FileText />} tone="cyan" />
        <StatCard
          label="Awaiting processing"
          value={formatNumber(pending)}
          icon={<Clock />}
          tone="amber"
          hint={pending > 0 ? "Processed in the background" : "Nothing pending"}
        />
        <StatCard label="Library size" value={formatBytes(stats.totalBytes)} icon={<HardDrive />} tone="violet" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 font-display text-[15px] font-semibold text-ink">Projects</h2>
          {projects.length === 0 ? (
            <EmptyState
              icon={<FolderPlus />}
              title="Start your first project"
              description={`Projects are focused learning journeys inside ${space.name}, each with its own goal and materials.`}
              action={
                <Button onClick={() => setProjectFormOpen(true)}>
                  <Plus className="size-4" /> New project
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} progress={progressOf.get(project.id)} />
              ))}
              <button
                onClick={() => setProjectFormOpen(true)}
                className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-white/50 text-sm font-medium text-muted transition hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-700"
              >
                <Plus className="size-5" /> New project
              </button>
            </div>
          )}
        </section>
        <div className="space-y-6 self-start">
          {projects.length > 0 && <LearningInsights progress={data.progress} attention={data.attention} />}
          <Card>
            <CardHeader title="Recent activity" description={`In ${space.name}`} />
            <CardBody className="pt-3">
              <ActivityFeed events={recentActivity} />
            </CardBody>
          </Card>
        </div>
      </div>

      <ProjectFormDialog
        open={projectFormOpen}
        onOpenChange={setProjectFormOpen}
        spaceId={space.id}
        spaceName={space.name}
        onSaved={(project) => router.push(`/projects/${project.id}`)}
      />
      <SpaceFormDialog open={editOpen} onOpenChange={setEditOpen} space={space} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this space?"
        description={
          <>
            <strong className="text-ink">{space.name}</strong> will be permanently deleted together with its{" "}
            {pluralize(stats.projectCount, "project")} and {pluralize(stats.materialCount, "uploaded material")}. This cannot be
            undone.
          </>
        }
        confirmLabel="Delete space"
        onConfirm={confirmDelete}
        loading={deleteSpace.isPending}
      />
    </div>
  );
}

export default function SpacePage() {
  return (
    <Suspense>
      <SpaceView />
    </Suspense>
  );
}
