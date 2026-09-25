"use client";

import { FileText, FolderKanban, MoreHorizontal, Pencil, Target, Trash2 } from "lucide-react";
import Link from "next/link";
import { SpaceTile } from "@/components/space-visuals";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { pluralize, timeAgo } from "@/lib/format";
import type { Project, RecentProject, Space, StatusCounts } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SpaceCard({ space, onEdit, onDelete }: { space: Space; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="group relative flex flex-col rounded-2xl border border-line bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <SpaceTile color={space.color} icon={space.icon} />
        <Menu
          trigger={
            <Button variant="ghost" size="icon" aria-label={`Actions for ${space.name}`} className="relative z-10 -mr-2 -mt-1">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        >
          <MenuItem icon={<Pencil />} onSelect={onEdit}>
            Edit space
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} onSelect={onDelete} danger>
            Delete space
          </MenuItem>
        </Menu>
      </div>
      <Link href={`/spaces/${space.id}`} className="mt-4 flex-1 after:absolute after:inset-0 after:rounded-2xl">
        <h3 className="font-display text-base font-semibold text-ink group-hover:text-blue-700">{space.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{space.description}</p>
      </Link>
      <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <FolderKanban className="size-3.5" /> {pluralize(space.projectCount, "project")}
        </span>
        <span className="flex items-center gap-1.5">
          <FileText className="size-3.5" /> {pluralize(space.materialCount, "material")}
        </span>
        <span className="ml-auto">{timeAgo(space.lastActivityAt)}</span>
      </div>
    </div>
  );
}

/** Proportional bar of material states (queued / processing / ready / failed). */
export function MaterialStatusBar({ counts, className }: { counts: StatusCounts; className?: string }) {
  const total = counts.queued + counts.processing + counts.ready + counts.failed;
  if (total === 0) return <div className={cn("h-1.5 rounded-full bg-slate-100", className)} />;
  const segments = [
    { n: counts.ready, cls: "bg-emerald-500", label: "ready" },
    { n: counts.processing, cls: "bg-blue-500", label: "processing" },
    { n: counts.queued, cls: "bg-amber-400", label: "queued" },
    { n: counts.failed, cls: "bg-red-500", label: "failed" },
  ].filter((s) => s.n > 0);
  return (
    <div
      className={cn("flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-slate-100", className)}
      title={segments.map((s) => `${s.n} ${s.label}`).join(" · ")}
    >
      {segments.map((s) => (
        <span key={s.label} className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function ProjectCard({ project, showSpace }: { project: Project | RecentProject; showSpace?: boolean }) {
  const space = "space" in project ? project.space : null;
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex h-full flex-col rounded-2xl border border-line bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lift"
    >
      {showSpace && space && (
        <span className="mb-3 inline-flex items-center gap-1.5 self-start text-xs font-medium text-muted">
          <SpaceTile color={space.color} icon={space.icon} size="sm" className="size-5 rounded-md [&>svg]:size-3" />
          {space.name}
        </span>
      )}
      <h3 className="font-display text-base font-semibold text-ink group-hover:text-blue-700">{project.name}</h3>
      <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted">
        <Target className="mt-0.5 size-3.5 shrink-0 text-blue-500" />
        <span className="line-clamp-2">{project.learningGoal}</span>
      </p>
      <div className="mt-auto space-y-2 pt-4">
        <MaterialStatusBar counts={project.materialStatusCounts} />
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{pluralize(project.materialCount, "material")}</span>
          <span>Active {timeAgo(project.lastActivityAt)}</span>
        </div>
      </div>
    </Link>
  );
}
