import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatNumber, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const sizes = { sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-14 text-lg" };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 to-indigo-600 font-semibold text-white ring-2 ring-white",
        sizes[size],
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  hint?: ReactNode;
  tone?: "blue" | "indigo" | "cyan" | "emerald" | "amber" | "violet";
}

const statTones = {
  blue: "bg-blue-50 text-blue-600",
  indigo: "bg-indigo-50 text-indigo-600",
  cyan: "bg-cyan-50 text-cyan-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
};

export function StatCard({ label, value, icon, hint, tone = "blue" }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className={cn("flex size-8 items-center justify-center rounded-lg [&>svg]:size-4", statTones[tone])}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-slate-400" />}
          {item.href ? (
            <Link href={item.href} className="truncate hover:text-blue-700">
              {item.label}
            </Link>
          ) : (
            <span className="truncate font-medium text-ink-soft">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  icon?: ReactNode;
}

export function PageHeader({ title, description, crumbs, actions, icon }: PageHeaderProps) {
  return (
    <header className="mb-6 space-y-3">
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {icon}
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
            {description && <div className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">{description}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Pagination({
  page,
  limit,
  total,
  onPageChange,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span>
        {total === 0 ? "No results" : `Showing ${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="px-2 tabular-nums">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
