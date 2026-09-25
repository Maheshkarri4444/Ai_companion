import { ArrowRight, Target } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { pluralize } from "@/lib/format";
import type { CognitiveLevel, ConceptMastery, MasteryBand, MasteryConfidence, MasterySummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export const pct = (value: number | null | undefined) => (value == null ? "—" : `${Math.round(value * 100)}%`);

export function bandOf(mastery: number | null): MasteryBand {
  if (mastery === null) return "not_assessed";
  if (mastery < 0.5) return "needs_attention";
  if (mastery < 0.8) return "developing";
  return "strong";
}

const BANDS: Record<MasteryBand, { label: string; tone: BadgeTone; bar: string; text: string }> = {
  not_assessed: { label: "Not assessed", tone: "slate", bar: "bg-slate-300", text: "text-muted" },
  needs_attention: { label: "Needs attention", tone: "red", bar: "bg-rose-500", text: "text-rose-600" },
  developing: { label: "Developing", tone: "amber", bar: "bg-amber-400", text: "text-amber-700" },
  strong: { label: "Strong", tone: "green", bar: "bg-emerald-500", text: "text-emerald-700" },
};

export const LEVEL_LABELS: Record<CognitiveLevel, string> = {
  recall: "Recall",
  understand: "Understanding",
  apply: "Application",
  analyze: "Analysis",
};

const CONFIDENCE_LABELS: Record<MasteryConfidence, string> = {
  none: "no evidence yet",
  low: "low confidence",
  medium: "medium confidence",
  high: "high confidence",
};

export function MasteryBadge({ band, className }: { band: MasteryBand; className?: string }) {
  return (
    <Badge tone={BANDS[band].tone} className={className}>
      {BANDS[band].label}
    </Badge>
  );
}

/** A mastery estimate as a bar; `before` draws the previous value as a marker so a change is visible at a glance. */
export function MasteryBar({ value, before, className }: { value: number | null; before?: number | null; className?: string }) {
  const band = bandOf(value);
  return (
    <div
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-slate-100", className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value == null ? undefined : Math.round(value * 100)}
      aria-label={value == null ? "Not assessed" : `Mastery ${pct(value)}`}
    >
      {value != null && <div className={cn("h-full rounded-full transition-all duration-700", BANDS[band].bar)} style={{ width: `${Math.max(3, value * 100)}%` }} />}
      {before != null && <span className="absolute top-0 h-full w-0.5 bg-ink/50" style={{ left: `calc(${before * 100}% - 1px)` }} aria-hidden />}
      {/* Band thresholds (50 % / 80 %) */}
      <span className="absolute top-0 left-1/2 h-full w-px bg-white/70" aria-hidden />
      <span className="absolute top-0 left-[80%] h-full w-px bg-white/70" aria-hidden />
    </div>
  );
}

/** "Mastery is always shown with its coverage": a high score on two of twenty concepts is not "done". */
export function MasteryOverview({ summary }: { summary: MasterySummary }) {
  return (
    <div className="grid grid-cols-3 gap-3 text-center">
      <div className="rounded-xl bg-slate-50 px-2 py-3">
        <p className="text-xl font-semibold tracking-tight text-ink">{pct(summary.overallMastery)}</p>
        <p className="text-xs text-muted">Overall mastery</p>
      </div>
      <div className="rounded-xl bg-slate-50 px-2 py-3">
        <p className="text-xl font-semibold tracking-tight text-ink">
          {summary.assessedConcepts}
          <span className="text-sm font-normal text-muted">/{summary.totalConcepts}</span>
        </p>
        <p className="text-xs text-muted">Concepts assessed</p>
      </div>
      <div className="rounded-xl bg-slate-50 px-2 py-3">
        <p className={cn("text-xl font-semibold tracking-tight", summary.needsAttention ? "text-rose-600" : "text-ink")}>{summary.needsAttention}</p>
        <p className="text-xs text-muted">Need attention</p>
      </div>
    </div>
  );
}

export function ConceptMasteryRow({
  concept,
  onPractice,
  practicing,
}: {
  concept: ConceptMastery;
  onPractice?: (concept: ConceptMastery) => void;
  practicing?: boolean;
}) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-ink" title={concept.description}>
          {concept.name}
        </p>
        <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">{pct(concept.mastery)}</span>
      </div>
      <MasteryBar value={concept.mastery} className="mt-1.5" />
      <div className="mt-1.5 flex items-start justify-between gap-2">
        <p className="min-w-0 text-xs leading-relaxed text-muted">
          <span className={cn("font-medium", BANDS[concept.band].text)}>{BANDS[concept.band].label}</span>
          {concept.evidenceCount > 0 && (
            <>
              {" "}
              · {pluralize(concept.evidenceCount, "answer")}, {CONFIDENCE_LABELS[concept.confidence]}
              {concept.weakestLevel && <> · weakest: {LEVEL_LABELS[concept.weakestLevel].toLowerCase()}</>}
            </>
          )}
        </p>
        {onPractice && (
          <Button
            size="sm"
            variant="ghost"
            className="-my-1 -mr-2 h-7 shrink-0 px-2 text-blue-700"
            onClick={() => onPractice(concept)}
            disabled={practicing}
            aria-label={`Practise ${concept.name}`}
          >
            <Target className="size-3.5" /> Practise
          </Button>
        )}
      </div>
    </li>
  );
}

/** One line: "Backpropagation 42% → 55%". */
export function MasteryChange({ name, before, after }: { name: string; before: number | null; after: number | null }) {
  const up = before != null && after != null ? after - before : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate font-medium text-ink">{name}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-muted tabular-nums">
          {before == null ? "new" : pct(before)}
          <ArrowRight className="size-3.5" />
          <span className="font-semibold text-ink">{pct(after)}</span>
          {up != null && Math.abs(up) >= 0.005 && (
            <span className={cn("text-xs font-medium", up > 0 ? "text-emerald-600" : "text-rose-600")}>
              {up > 0 ? "+" : "−"}
              {Math.round(Math.abs(up) * 100)}
            </span>
          )}
        </span>
      </div>
      <MasteryBar value={after} before={before} />
    </div>
  );
}
