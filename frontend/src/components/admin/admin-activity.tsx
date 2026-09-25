import Link from "next/link";
import { describeActivity } from "@/components/activity-feed";
import { Avatar } from "@/components/ui/misc";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { AdminActivityEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Activity rows attributed to the learner (and the actor, when someone else acted). */
export function AdminActivityList({ events }: { events: AdminActivityEvent[] }) {
  if (events.length === 0) return <p className="py-8 text-center text-sm text-muted">No activity yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {events.map((event) => {
        const { Icon, tone, text } = describeActivity(event);
        return (
          <li key={event.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", tone)}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-ink-soft">
                {event.user ? (
                  <Link href={`/admin/users/${event.user.id}`} className="font-semibold text-ink hover:text-blue-700">
                    {event.user.name}
                  </Link>
                ) : (
                  <span className="font-semibold text-ink">Deleted user</span>
                )}{" "}
                · {text}
              </p>
              <p className="mt-0.5 text-xs text-muted" title={formatDateTime(event.createdAt)}>
                {timeAgo(event.createdAt)}
                {event.actor && event.user && event.actor.id !== event.user.id && <> · by {event.actor.name}</>}
              </p>
            </div>
            {event.user && <Avatar name={event.user.name} size="sm" className="hidden ring-0 sm:inline-flex" />}
          </li>
        );
      })}
    </ul>
  );
}
