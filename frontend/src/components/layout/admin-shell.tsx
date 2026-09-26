"use client";

import { Activity, BarChart3, Bot, Cpu, FileText, FolderKanban, Gauge, GraduationCap, Layers, LayoutDashboard, ShieldAlert, Users, Workflow } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { useMe } from "@/lib/queries";
import { AppShell, type NavSection } from "./app-shell";

const sections: NavSection[] = [
  {
    items: [{ href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true }],
  },
  {
    title: "Learning platform",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/spaces", label: "Spaces", icon: Layers },
      { href: "/admin/projects", label: "Projects", icon: FolderKanban },
      { href: "/admin/materials", label: "Materials", icon: FileText },
      { href: "/admin/activity", label: "Activity", icon: Activity },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/admin/engagement", label: "Engagement", icon: BarChart3 },
      { href: "/admin/learning", label: "Learning analytics", icon: GraduationCap },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/admin/system", label: "System health", icon: Gauge },
      { href: "/admin/ai-usage", label: "AI usage", icon: Cpu },
      { href: "/admin/ai-evaluation", label: "AI evaluation", icon: Bot },
      { href: "/admin/jobs", label: "Background jobs", icon: Workflow },
    ],
  },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useMe();
  if (isLoading || !user) return <PageLoader label="Loading admin console…" />;

  // UX guard only: every /api/admin request is independently authorised by the API.
  if (user.role !== "admin") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <EmptyState
          icon={<ShieldAlert />}
          title="Administrators only"
          description="Your account doesn't have access to the admin console."
          action={
            <Link href="/dashboard" className={buttonClasses("primary", "sm")}>
              Go to your workspace
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <AppShell user={user} area="admin" sections={sections}>
      {children}
    </AppShell>
  );
}
