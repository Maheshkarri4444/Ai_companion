import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-blue-600", className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} aria-hidden />;
}

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted">
      <Spinner className="size-6" />
      {label}
    </div>
  );
}

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-white/60 text-center",
        compact ? "gap-2 px-6 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-2xl bg-linear-to-br from-blue-500 to-indigo-600 text-white shadow-glow",
          compact ? "size-10 [&>svg]:size-5" : "size-12 [&>svg]:size-6",
        )}
      >
        {icon}
      </span>
      <div className="max-w-sm">
        <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50/60 px-6 py-10 text-center", className)}>
      <AlertTriangle className="size-6 text-red-500" />
      <div>
        <p className="font-medium text-red-800">Couldn&apos;t load this</p>
        <p className="mt-1 text-sm text-red-700/80">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
