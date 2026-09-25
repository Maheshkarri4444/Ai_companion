import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary:
    "text-white bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:from-blue-700 active:to-indigo-700 shadow-[0_8px_20px_-8px_rgb(37_99_235/0.7)]",
  secondary: "bg-white text-ink border border-line-strong hover:bg-slate-50 hover:border-slate-300 shadow-card",
  ghost: "text-ink-soft hover:bg-slate-100 hover:text-ink",
  subtle: "bg-blue-50 text-blue-700 hover:bg-blue-100",
  danger: "bg-red-600 text-white hover:bg-red-500 shadow-sm",
  "danger-ghost": "text-red-600 hover:bg-red-50",
} as const;

const sizes = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-11 px-5 text-sm gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-lg justify-center",
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

/** Shared with <Link> so links can look like buttons without nesting interactive elements. */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all duration-150 outline-none select-none",
    "focus-visible:ring-4 focus-visible:ring-blue-500/25 disabled:pointer-events-none disabled:opacity-55",
    variants[variant],
    sizes[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({ variant, size, loading, disabled, className, children, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} className={buttonClasses(variant, size, className)} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
