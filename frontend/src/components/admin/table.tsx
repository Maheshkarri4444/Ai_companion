"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode, type ThHTMLAttributes, type TdHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto scrollbar-thin", className)}>
      <table className="w-full min-w-[720px] text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn("border-b border-line bg-canvas/70 px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-muted uppercase", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line px-4 py-3 align-middle text-ink-soft", className)} {...props} />;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-muted">
        {children}
      </td>
    </tr>
  );
}

/**
 * Filters live in the URL: shareable, back-button friendly, and deep-linkable from other admin views
 * (e.g. /admin/activity?userId=…). Changing any filter resets pagination.
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const values = Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, searchParams.get(key) ?? fallback]),
  ) as T;

  const update = (patch: Partial<T>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === defaults[key]) next.delete(key);
      else next.set(key, value as string);
    }
    if (!("page" in patch)) next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return [values, update] as const;
}

/** Debounced search box; the committed value lives in the URL. */
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const [sent, setSent] = useState<string | null>(null);
  // Adopt external URL changes (e.g. "clear filters") but never our own echo, which could
  // otherwise overwrite keystrokes typed while the URL update was in flight.
  if (value !== synced) {
    setSynced(value);
    if (value !== sent) setDraft(value);
  }

  useEffect(() => {
    const next = draft.trim();
    if (next === value) return;
    const timer = setTimeout(() => {
      setSent(next);
      onChange(next);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-xl border border-line-strong bg-white pr-9 pl-9 text-sm text-ink shadow-card outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
      />
      {draft && (
        <button
          onClick={() => setDraft("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center">{children}</div>;
}
