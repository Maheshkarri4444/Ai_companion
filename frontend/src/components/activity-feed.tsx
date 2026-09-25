import {
  FilePlus2,
  FileMinus2,
  FilePen,
  FolderPlus,
  FolderPen,
  FolderMinus,
  Layers,
  LogIn,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { timeAgo, formatBytes } from "@/lib/format";
import type { ActivityEvent, ActivityType } from "@/lib/types";
import { cn } from "@/lib/utils";

const str = (value: unknown) => (typeof value === "string" ? value : "");

interface Described {
  Icon: LucideIcon;
  tone: string;
  text: ReactNode;
}

/** Turns an event + its metadata snapshot into a human sentence (history stays readable after deletes). */
export function describeActivity(event: Pick<ActivityEvent, "type" | "metadata">): Described {
  const m = event.metadata ?? {};
  const q = (value: unknown) => <strong className="font-medium text-ink">{str(value) || "untitled"}</strong>;
  switch (event.type) {
    case "user.registered":
      return { Icon: UserPlus, tone: "bg-emerald-50 text-emerald-600", text: <>Joined AI Study Companion</> };
    case "user.logged_in":
      return { Icon: LogIn, tone: "bg-slate-100 text-slate-500", text: <>Signed in</> };
    case "space.created":
      return { Icon: Layers, tone: "bg-blue-50 text-blue-600", text: <>Created space {q(m.spaceName)}</> };
    case "space.updated":
      return { Icon: Layers, tone: "bg-slate-100 text-slate-600", text: <>Updated space {q(m.spaceName)}</> };
    case "space.deleted":
      return { Icon: Layers, tone: "bg-red-50 text-red-500", text: <>Deleted space {q(m.spaceName)}</> };
    case "project.created":
      return {
        Icon: FolderPlus,
        tone: "bg-indigo-50 text-indigo-600",
        text: (
          <>
            Started project {q(m.projectName)}
            {str(m.spaceName) && <> in {q(m.spaceName)}</>}
          </>
        ),
      };
    case "project.updated":
      return { Icon: FolderPen, tone: "bg-slate-100 text-slate-600", text: <>Updated project {q(m.projectName)}</> };
    case "project.deleted":
      return { Icon: FolderMinus, tone: "bg-red-50 text-red-500", text: <>Deleted project {q(m.projectName)}</> };
    case "material.uploaded":
      return {
        Icon: FilePlus2,
        tone: "bg-cyan-50 text-cyan-600",
        text: (
          <>
            Uploaded {q(m.materialTitle)} to {q(m.projectName)}
            {typeof m.sizeBytes === "number" && <span className="text-muted"> · {formatBytes(m.sizeBytes)}</span>}
          </>
        ),
      };
    case "material.updated":
      return { Icon: FilePen, tone: "bg-slate-100 text-slate-600", text: <>Renamed material to {q(m.materialTitle)}</> };
    case "material.deleted":
      return { Icon: FileMinus2, tone: "bg-red-50 text-red-500", text: <>Removed {q(m.materialTitle)} from {q(m.projectName)}</> };
    default:
      return { Icon: Layers, tone: "bg-slate-100 text-slate-500", text: <>{(event.type as string).replace(/[._]/g, " ")}</> };
  }
}

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  "user.registered": "Account created",
  "user.logged_in": "Signed in",
  "space.created": "Space created",
  "space.updated": "Space updated",
  "space.deleted": "Space deleted",
  "project.created": "Project created",
  "project.updated": "Project updated",
  "project.deleted": "Project deleted",
  "material.uploaded": "Material uploaded",
  "material.updated": "Material renamed",
  "material.deleted": "Material deleted",
};

function eventHref(event: ActivityEvent): string | undefined {
  if (event.type.endsWith(".deleted")) return undefined;
  if (event.type.startsWith("material.") && event.projectId) return `/projects/${event.projectId}/materials`;
  if (event.projectId) return `/projects/${event.projectId}`;
  if (event.spaceId) return `/spaces/${event.spaceId}`;
  return undefined;
}

export function ActivityFeed({
  events,
  linkify = true,
  className,
}: {
  events: ActivityEvent[];
  linkify?: boolean;
  className?: string;
}) {
  if (events.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-muted">No activity yet.</p>;
  }
  return (
    <ol className={cn("relative space-y-1", className)}>
      {events.map((event, i) => {
        const { Icon, tone, text } = describeActivity(event);
        const href = linkify ? eventHref(event) : undefined;
        const body = (
          <div className="flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-slate-50">
            <span className="relative flex flex-col items-center">
              <span className={cn("flex size-8 items-center justify-center rounded-lg", tone)}>
                <Icon className="size-4" />
              </span>
              {i < events.length - 1 && <span className="absolute top-9 h-[calc(100%-4px)] w-px bg-line" aria-hidden />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm leading-snug text-ink-soft">{text}</p>
              <p className="mt-0.5 text-xs text-muted">{timeAgo(event.createdAt)}</p>
            </div>
          </div>
        );
        return <li key={event.id}>{href ? <Link href={href}>{body}</Link> : body}</li>;
      })}
    </ol>
  );
}
