"use client";

import { ArrowRight, CheckCircle2, CircleAlert, FileText, Search, Wrench } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useAiCall } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const usd = (value: number) => (value === 0 ? "$0" : value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(3)}`);
export const ms = (value: number | null | undefined) => (value == null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`);

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase [&>svg]:size-3.5">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function KV({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="truncate font-medium text-ink tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return status === "success" ? (
    <Badge tone="green">
      <CheckCircle2 className="size-3" /> success
    </Badge>
  ) : (
    <Badge tone="red">
      <CircleAlert className="size-3" /> {status}
    </Badge>
  );
}

/**
 * Everything needed to answer "why was it slow / which model / why was retrieval poor / what did it cost":
 * attempts, the request waterfall, and the Tutor's grounding + retrieval trace.
 */
export function AiCallDialog({ callId, onClose }: { callId: string | null; onClose: () => void }) {
  const [current, setCurrent] = useState<string | null>(callId);
  const [opened, setOpened] = useState(callId);
  if (callId !== opened) {
    setOpened(callId);
    setCurrent(callId);
  }
  const { data, isLoading, error, refetch } = useAiCall(current);

  return (
    <Dialog open={Boolean(callId)} onOpenChange={(open) => !open && onClose()} title="AI call trace" size="lg">
      {isLoading || !data ? (
        error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-40" />
          </div>
        )
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{data.call.feature}</Badge>
            <Badge tone="slate">{data.call.operation}</Badge>
            <StatusBadge status={data.call.status} />
            {data.call.fallbackUsed && <Badge tone="amber">fallback used</Badge>}
            {data.call.errorKind && <Badge tone="red">{data.call.errorKind}</Badge>}
          </div>
          <KV
            items={[
              ["Model", data.call.model ?? "—"],
              ["Latency", ms(data.call.latencyMs)],
              ["Time to first token", ms(data.call.ttftMs)],
              ["Tokens in / out / thinking", `${formatNumber(data.call.usage.inputTokens)} / ${formatNumber(data.call.usage.outputTokens)} / ${formatNumber(data.call.usage.thinkingTokens)}`],
              ["Estimated cost", usd(data.call.costUsd)],
              ["Prompt version", data.call.promptVersion ?? "—"],
              ["User", data.user ? <Link href={`/admin/users/${data.user.id}`} className="text-blue-700 hover:underline">{data.user.name}</Link> : "—"],
              ["Project", data.project?.name ?? "—"],
              ["When", formatDateTime(data.call.createdAt)],
            ]}
          />
          {data.call.errorMessage && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs break-words text-red-800">{data.call.errorMessage}</p>}

          <Section title="Attempts (retries & model fallback)">
            <ol className="space-y-1.5">
              {data.call.attempts.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-5 text-xs text-muted">{i + 1}.</span>
                  <span className="font-medium text-ink">{a.model}</span>
                  <StatusBadge status={a.status === "success" ? "success" : (a.kind ?? "error")} />
                  <span className="text-xs text-muted tabular-nums">{ms(a.ms)}</span>
                  {a.message && <span className="w-full truncate pl-7 text-xs text-muted">{a.message}</span>}
                </li>
              ))}
            </ol>
          </Section>

          {data.related.length > 1 && (
            <Section title="Request waterfall (all AI calls for this request)">
              <ul className="space-y-1">
                {data.related.map((r) => {
                  const max = Math.max(...data.related.map((x) => x.latencyMs), 1);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setCurrent(r.id)}
                        className={cn("grid w-full grid-cols-[150px_1fr_64px] items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-slate-50", r.id === current && "bg-blue-50")}
                      >
                        <span className="truncate font-medium text-ink">{r.feature}</span>
                        <span className="h-2 rounded-full bg-slate-100">
                          <span className={cn("block h-2 rounded-full", r.status === "success" ? "bg-blue-500" : "bg-red-500")} style={{ width: `${Math.max(3, (r.latencyMs / max) * 100)}%` }} />
                        </span>
                        <span className="text-right text-muted tabular-nums">{ms(r.latencyMs)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {data.message && <TutorTrace message={data.message} />}

          {data.job && (
            <Section title="Background job">
              <p className="text-sm">
                <Link href={`/admin/jobs?jobId=${data.job.id}`} className="font-medium text-blue-700 hover:underline">
                  {data.job.type}
                </Link>{" "}
                · {data.job.status} · attempt {data.job.attempts}
              </p>
            </Section>
          )}

          {(data.call.inputPreview || data.call.outputPreview) && (
            <Section title="Input / output preview">
              {data.call.inputPreview && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs break-words whitespace-pre-wrap text-ink-soft">{data.call.inputPreview}</p>}
              {data.call.outputPreview && <p className="rounded-lg bg-blue-50/60 px-3 py-2 text-xs break-words whitespace-pre-wrap text-ink-soft">{data.call.outputPreview}</p>}
            </Section>
          )}
        </div>
      )}
    </Dialog>
  );
}

type Trace = {
  route?: string;
  intent?: string;
  understandMethod?: string;
  standaloneQuery?: string;
  flags?: string[];
  carriedSources?: number;
  context?: Array<{ id: string; status: string; chars: number; ms: number }>;
  retrieval?: {
    method?: string;
    sufficiency?: string;
    topScore?: number;
    thresholds?: { strong: number; min: number };
    timingsMs?: { embed: number; search: number; total: number };
    embeddingError?: string;
    selected?: Array<{ chunkId: string; material: string; pages: string; score: number; lexicalRank: number | null; fused: number }>;
    vectorCandidates?: Array<{ chunkId: string; score: number }>;
    lexicalCandidates?: Array<{ chunkId: string; score: number }>;
  } | null;
};

function TutorTrace({ message }: { message: NonNullable<import("@/lib/types").AiCallDetail["message"]> }) {
  const trace = message.trace as Trace;
  const r = trace.retrieval;
  return (
    <>
      <Section title="Tutor turn" icon={<ArrowRight />}>
        {message.question && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-ink">
            <span className="text-xs text-muted">Learner: </span>
            {message.question}
          </p>
        )}
        <KV
          items={[
            ["Grounding", message.grounding?.status ?? "—"],
            ["Intent / route", `${trace.intent ?? "—"} / ${trace.route ?? "—"}`],
            ["Understood via", trace.understandMethod ?? "—"],
            ["Standalone query", trace.standaloneQuery || "—"],
            ["Invalid citations removed", String(message.grounding?.invalidCitations ?? 0)],
            ["Carried-over sources", String(trace.carriedSources ?? 0)],
          ]}
        />
        {trace.flags && trace.flags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {trace.flags.map((f) => (
              <Badge key={f} tone="amber">
                {f}
              </Badge>
            ))}
          </div>
        )}
        {message.feedback && (
          <p className="text-xs text-muted">
            Learner feedback: <strong className="text-ink">{message.feedback.rating}</strong>
            {message.feedback.reason ? ` (${message.feedback.reason})` : ""}
          </p>
        )}
      </Section>

      {r && (
        <Section title="Retrieval trace" icon={<Search />}>
          <KV
            items={[
              ["Method", r.method ?? "—"],
              ["Sufficiency", r.sufficiency ?? "—"],
              ["Top similarity", r.topScore != null ? r.topScore.toFixed(3) : "—"],
              ["Thresholds (strong / min)", r.thresholds ? `${r.thresholds.strong} / ${r.thresholds.min}` : "—"],
              ["Embed / search", r.timingsMs ? `${r.timingsMs.embed} ms / ${r.timingsMs.search} ms` : "—"],
              ["Embedding error", r.embeddingError ?? "none"],
            ]}
          />
          {r.selected && r.selected.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 font-medium">Selected evidence</th>
                  <th className="py-1 text-right font-medium">Cosine</th>
                  <th className="py-1 text-right font-medium">Lexical rank</th>
                  <th className="py-1 text-right font-medium">Fused</th>
                </tr>
              </thead>
              <tbody>
                {r.selected.map((s) => {
                  const source = message.sources.find((x) => `${x.pageStart}` === s.pages.split("-")[0] && x.materialTitle === s.material);
                  return (
                    <tr key={s.chunkId} className="border-t border-line">
                      <td className="py-1.5 pr-2">
                        <span className="font-medium text-ink">{s.material}</span> · p. {s.pages}
                        {source?.cited && <Badge tone="green" className="ml-1.5">cited</Badge>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{s.score.toFixed(3)}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.lexicalRank ?? "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.fused}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {trace.context && trace.context.length > 0 && (
        <Section title="Learner context composed">
          <div className="flex flex-wrap gap-1.5">
            {trace.context.map((c) => (
              <Badge key={c.id} tone={c.status === "ok" ? "blue" : c.status === "error" ? "red" : "slate"}>
                {c.id} · {c.status}
                {c.chars ? ` · ${c.chars} chars` : ""} · {c.ms} ms
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {message.toolCalls.length > 0 && (
        <Section title="Tool calls (validated & scoped)" icon={<Wrench />}>
          <ul className="space-y-1 text-xs">
            {message.toolCalls.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <StatusBadge status={t.ok ? "success" : (t.error ?? "failed")} />
                <span className="font-medium text-ink">{t.name}</span>
                <code className="truncate text-muted">{JSON.stringify(t.args)}</code>
                <span className="text-muted">· {t.summary} · {ms(t.latencyMs)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Answer" icon={<FileText />}>
        <p className="scrollbar-thin max-h-48 overflow-y-auto rounded-lg bg-blue-50/50 px-3 py-2 text-xs whitespace-pre-wrap text-ink-soft">{message.content || "—"}</p>
      </Section>
    </>
  );
}
