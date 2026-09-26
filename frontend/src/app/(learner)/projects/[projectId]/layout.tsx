"use client";

import {
  ChartColumn,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Target,
  Trash2,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { SpaceTile } from "@/components/space-visuals";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Breadcrumbs } from "@/components/ui/misc";
import { ApiError, errorMessage } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { useDeleteProject, useProject } from "@/lib/queries";
import { cn } from "@/lib/utils";

const tabs = [
  { segment: "", label: "Overview", icon: LayoutDashboard },
  { segment: "materials", label: "Materials", icon: FileText },
  { segment: "tutor", label: "AI Tutor", icon: MessageSquare },
  { segment: "quiz", label: "Quiz", icon: ListChecks },
  { segment: "growth", label: "Growth", icon: TrendingUp },
  { segment: "analytics", label: "Analytics", icon: ChartColumn },
];

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useProject(projectId);
  const deleteProject = useDeleteProject();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-60" />
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="mt-6 h-11 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        icon={<FolderKanban />}
        title="Project not found"
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

  const { project, space, stats } = data;
  const base = `/projects/${project.id}`;

  async function confirmDelete() {
    try {
      await deleteProject.mutateAsync(project.id);
      toast.success(`Deleted “${project.name}”`);
      router.replace(space ? `/spaces/${space.id}` : "/spaces");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="animate-rise">
      <header className="space-y-3">
        <Breadcrumbs
          items={[
            { label: "Spaces", href: "/spaces" },
            ...(space ? [{ label: space.name, href: `/spaces/${space.id}` }] : []),
            { label: project.name },
          ]}
        />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            {space && <SpaceTile color={space.color} icon={space.icon} size="lg" />}
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{project.name}</h1>
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-soft">
                <Target className="mt-0.5 size-4 shrink-0 text-blue-600" />
                <span>
                  <span className="font-medium text-ink">Goal:</span> {project.learningGoal}
                </span>
              </p>
            </div>
          </div>
          <Menu
            trigger={
              <Button variant="secondary" size="icon" aria-label="Project actions" className="self-start">
                <MoreHorizontal className="size-4" />
              </Button>
            }
          >
            <MenuItem icon={<Pencil />} onSelect={() => setEditOpen(true)}>
              Edit project
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} onSelect={() => setDeleteOpen(true)} danger>
              Delete project
            </MenuItem>
          </Menu>
        </div>
      </header>

      <nav className="scrollbar-thin mt-6 -mx-4 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0" aria-label="Project sections">
        <ul className="flex min-w-max gap-1">
          {tabs.map(({ segment, label, icon: Icon }) => {
            const href = segment ? `${base}/${segment}` : base;
            // Sections own their sub-routes (e.g. a quiz session under /quiz); Overview is the exact path only.
            const active = pathname === href || (Boolean(segment) && pathname.startsWith(`${href}/`));
            return (
              <li key={label}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "border-blue-600 text-blue-700" : "border-transparent text-muted hover:border-line-strong hover:text-ink",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="pt-6">{children}</div>

      {space && <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} spaceId={space.id} project={project} />}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this project?"
        description={
          <>
            <strong className="text-ink">{project.name}</strong> and its {pluralize(stats.materialCount, "uploaded material")} will
            be permanently deleted. This cannot be undone.
          </>
        }
        confirmLabel="Delete project"
        onConfirm={confirmDelete}
        loading={deleteProject.isPending}
      />
    </div>
  );
}
