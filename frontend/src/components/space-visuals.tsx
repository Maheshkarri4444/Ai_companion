import {
  Atom,
  BookOpen,
  Brain,
  Briefcase,
  Calculator,
  ChartLine,
  Code2,
  Cpu,
  FlaskConical,
  Globe,
  GraduationCap,
  Languages,
  Music,
  Palette,
  Rocket,
  Scale,
  type LucideIcon,
} from "lucide-react";
import type { SpaceColor, SpaceIcon } from "@/lib/types";
import { cn } from "@/lib/utils";

// Full class strings (not interpolated) so Tailwind can see them at build time.
export const SPACE_COLOR_STYLES: Record<SpaceColor, { tile: string; soft: string; dot: string; swatch: string; label: string }> = {
  blue: { tile: "from-blue-500 to-blue-700", soft: "bg-blue-50 text-blue-700", dot: "bg-blue-500", swatch: "bg-blue-500", label: "Blue" },
  indigo: { tile: "from-indigo-500 to-indigo-700", soft: "bg-indigo-50 text-indigo-700", dot: "bg-indigo-500", swatch: "bg-indigo-500", label: "Indigo" },
  violet: { tile: "from-violet-500 to-violet-700", soft: "bg-violet-50 text-violet-700", dot: "bg-violet-500", swatch: "bg-violet-500", label: "Violet" },
  cyan: { tile: "from-cyan-400 to-cyan-600", soft: "bg-cyan-50 text-cyan-700", dot: "bg-cyan-500", swatch: "bg-cyan-500", label: "Cyan" },
  teal: { tile: "from-teal-400 to-teal-600", soft: "bg-teal-50 text-teal-700", dot: "bg-teal-500", swatch: "bg-teal-500", label: "Teal" },
  emerald: { tile: "from-emerald-400 to-emerald-600", soft: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", swatch: "bg-emerald-500", label: "Emerald" },
  amber: { tile: "from-amber-400 to-amber-600", soft: "bg-amber-50 text-amber-800", dot: "bg-amber-500", swatch: "bg-amber-500", label: "Amber" },
  rose: { tile: "from-rose-400 to-rose-600", soft: "bg-rose-50 text-rose-700", dot: "bg-rose-500", swatch: "bg-rose-500", label: "Rose" },
  slate: { tile: "from-slate-500 to-slate-700", soft: "bg-slate-100 text-slate-700", dot: "bg-slate-500", swatch: "bg-slate-500", label: "Slate" },
};

export const SPACE_ICONS: Record<SpaceIcon, { Icon: LucideIcon; label: string }> = {
  book: { Icon: BookOpen, label: "Book" },
  brain: { Icon: Brain, label: "Brain" },
  code: { Icon: Code2, label: "Code" },
  flask: { Icon: FlaskConical, label: "Science" },
  calculator: { Icon: Calculator, label: "Math" },
  globe: { Icon: Globe, label: "World" },
  palette: { Icon: Palette, label: "Art" },
  music: { Icon: Music, label: "Music" },
  briefcase: { Icon: Briefcase, label: "Business" },
  rocket: { Icon: Rocket, label: "Rocket" },
  cpu: { Icon: Cpu, label: "Hardware" },
  languages: { Icon: Languages, label: "Languages" },
  chart: { Icon: ChartLine, label: "Data" },
  atom: { Icon: Atom, label: "Physics" },
  scale: { Icon: Scale, label: "Law" },
  graduation: { Icon: GraduationCap, label: "Exam" },
};

const tileSizes = {
  sm: "size-7 rounded-lg [&>svg]:size-3.5",
  md: "size-10 rounded-xl [&>svg]:size-5",
  lg: "size-14 rounded-2xl [&>svg]:size-7",
};

export function SpaceTile({
  color,
  icon,
  size = "md",
  className,
}: {
  color: SpaceColor;
  icon: SpaceIcon;
  size?: keyof typeof tileSizes;
  className?: string;
}) {
  const { Icon } = SPACE_ICONS[icon] ?? SPACE_ICONS.book;
  const style = SPACE_COLOR_STYLES[color] ?? SPACE_COLOR_STYLES.blue;
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center bg-linear-to-br text-white shadow-sm", style.tile, tileSizes[size], className)}
      aria-hidden
    >
      <Icon />
    </span>
  );
}
