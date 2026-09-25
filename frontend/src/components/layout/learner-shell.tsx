"use client";

import { ChartColumn, House, Layers, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SPACE_COLOR_STYLES } from "@/components/space-visuals";
import { PageLoader } from "@/components/ui/feedback";
import { useMe, useSpaces } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { AppShell, type NavSection } from "./app-shell";

const sections: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Home", icon: House, exact: true },
      { href: "/spaces", label: "Spaces", icon: Layers },
      { href: "/analytics", label: "Analytics", icon: ChartColumn, soon: true },
    ],
  },
];

function SidebarSpaces() {
  const { data: spaces } = useSpaces();
  const pathname = usePathname();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-3">
        <p className="text-[11px] font-semibold tracking-wider text-blue-200/45 uppercase">Your spaces</p>
        <Link
          href="/spaces?new=1"
          className="rounded-md p-1 text-blue-200/50 hover:bg-white/10 hover:text-white"
          aria-label="New space"
          title="New space"
        >
          <Plus className="size-3.5" />
        </Link>
      </div>
      {spaces && spaces.length === 0 && <p className="px-3 text-xs text-blue-100/40">No spaces yet</p>}
      <ul className="space-y-0.5">
        {spaces?.slice(0, 8).map((space) => {
          const active = pathname === `/spaces/${space.id}`;
          return (
            <li key={space.id}>
              <Link
                href={`/spaces/${space.id}`}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm transition-colors",
                  active ? "bg-white/10 text-white" : "text-blue-100/65 hover:bg-white/5 hover:text-white",
                )}
              >
                <span className={cn("size-2 shrink-0 rounded-full", SPACE_COLOR_STYLES[space.color]?.dot ?? "bg-blue-500")} />
                <span className="truncate">{space.name}</span>
                <span className="ml-auto text-xs text-blue-200/40 tabular-nums">{space.projectCount}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LearnerShell({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useMe();
  // A 401 is handled globally (session cleared, redirect to /login).
  if (isLoading || !user) return <PageLoader label="Loading your workspace…" />;
  return (
    <AppShell user={user} area="learner" sections={sections} sidebarExtra={<SidebarSpaces />}>
      {children}
    </AppShell>
  );
}
