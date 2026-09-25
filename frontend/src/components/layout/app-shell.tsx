"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, LogOut, Menu as MenuIcon, ShieldCheck, LayoutDashboard, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/brand";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Avatar } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  soon?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLinks({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-6">
      {sections.map((section, i) => (
        <div key={section.title ?? i}>
          {section.title && (
            <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-blue-200/45 uppercase">{section.title}</p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = !item.soon && isActive(pathname, item);
              const Icon = item.icon;
              if (item.soon) {
                return (
                  <li key={item.href}>
                    <span
                      className="flex cursor-default items-center gap-3 rounded-xl px-3 py-2 text-sm text-blue-100/35"
                      title="Coming in a later build"
                    >
                      <Icon className="size-[18px]" />
                      <span className="flex-1">{item.label}</span>
                      <span className="rounded-full bg-white/5 px-1.5 py-px text-[10px] font-medium text-blue-100/45 ring-1 ring-white/10">
                        Soon
                      </span>
                    </span>
                  </li>
                );
              }
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-white/10 text-white" : "text-blue-100/70 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    {active && (
                      <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-linear-to-b from-cyan-300 to-blue-400" aria-hidden />
                    )}
                    <Icon className={cn("size-[18px]", active ? "text-cyan-300" : "text-blue-200/60 group-hover:text-blue-100")} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenu({ user, area }: { user: User; area: "learner" | "admin" }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  async function signOut() {
    try {
      await api.post("/auth/logout");
    } catch {
      toast.error("Could not reach the server, signing out locally.");
    }
    queryClient.clear();
    router.replace("/login");
  }

  return (
    <Menu
      align="start"
      trigger={
        <button className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-blue-400/40 outline-none">
          <Avatar name={user.name} size="sm" className="ring-navy-900" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">{user.name}</span>
            <span className="block truncate text-xs text-blue-200/55">{user.email}</span>
          </span>
          <ChevronsUpDown className="size-4 text-blue-200/50" />
        </button>
      }
    >
      <MenuLabel>Signed in as {user.role === "admin" ? "administrator" : "learner"}</MenuLabel>
      {user.role === "admin" && area === "learner" && (
        <MenuItem icon={<ShieldCheck />} onSelect={() => router.push("/admin")}>
          Admin console
        </MenuItem>
      )}
      {user.role === "admin" && area === "admin" && (
        <MenuItem icon={<LayoutDashboard />} onSelect={() => router.push("/dashboard")}>
          Learner workspace
        </MenuItem>
      )}
      {user.role === "admin" && <MenuSeparator />}
      <MenuItem icon={<LogOut />} onSelect={signOut} danger>
        Sign out
      </MenuItem>
    </Menu>
  );
}

interface AppShellProps {
  user: User;
  area: "learner" | "admin";
  sections: NavSection[];
  sidebarExtra?: ReactNode;
  children: ReactNode;
}

export function AppShell({ user, area, sections, sidebarExtra, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  // Close the mobile drawer after any navigation (adjust-state-on-prop-change, no effect needed).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-navy-950 bg-[radial-gradient(400px_circle_at_0%_0%,rgb(37_99_235/0.22),transparent_60%)]">
      <div className="flex h-16 items-center px-5">
        <Link href={area === "admin" ? "/admin" : "/dashboard"} onClick={onNavigate}>
          <Logo dark subtitle={area === "admin" ? "Admin console" : undefined} />
        </Link>
      </div>
      <div className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <NavLinks sections={sections} onNavigate={onNavigate} />
        {sidebarExtra}
      </div>
      <div className="border-t border-white/10 p-3">
        <UserMenu user={user} area={area} />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar()}</aside>

      <RadixDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-navy-950/50 backdrop-blur-[2px] lg:hidden" />
          <RadixDialog.Content className="fixed inset-y-0 left-0 z-50 w-72 shadow-2xl outline-none data-[state=open]:animate-fade-in lg:hidden">
            <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">Main navigation</RadixDialog.Description>
            {sidebar(() => setMobileOpen(false))}
            <RadixDialog.Close className="absolute top-4 right-3 rounded-lg p-1.5 text-blue-100/70 hover:bg-white/10" aria-label="Close menu">
              <X className="size-5" />
            </RadixDialog.Close>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white/85 px-4 backdrop-blur lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-ink-soft hover:bg-slate-100"
            aria-label="Open menu"
          >
            <MenuIcon className="size-5" />
          </button>
          <Logo subtitle={area === "admin" ? "Admin console" : undefined} />
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
