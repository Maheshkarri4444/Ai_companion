import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 via-indigo-500 to-cyan-400 text-white shadow-glow",
        className,
      )}
      aria-hidden
    >
      <Sparkles className="size-[18px]" strokeWidth={2.2} />
    </span>
  );
}

export function Logo({ dark = false, subtitle }: { dark?: boolean; subtitle?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className={cn("block font-display text-[15px] font-semibold tracking-tight", dark ? "text-white" : "text-ink")}>
          Study Companion
        </span>
        <span className={cn("block text-[11px] font-medium tracking-wide", dark ? "text-blue-200/70" : "text-muted")}>
          {subtitle ?? "AI learning workspace"}
        </span>
      </span>
    </span>
  );
}
