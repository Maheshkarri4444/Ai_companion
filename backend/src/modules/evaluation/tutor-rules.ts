import type { IMessage } from '../../models/message.model';
import { recordEvaluation } from './evaluation.service';

export interface RuleCheck {
  name: string;
  passed: boolean;
  severity: 'fail' | 'warn';
  detail?: string;
}

const TTFT_SLO_MS = 6000;
const LATENCY_SLO_MS = 30_000;

/**
 * Deterministic checks run on every Tutor answer (free, synchronous). They catch the failure modes that
 * matter most for trust: fabricated or missing citations, answering without evidence, leaked control
 * markers, and latency regressions. Also reused by the offline suite.
 */
export function tutorRuleChecks(message: Pick<IMessage, 'content' | 'grounding' | 'sources' | 'suggestions' | 'metrics' | 'status'>): RuleCheck[] {
  const cited = message.sources.filter((s) => s.cited);
  const status = message.grounding?.status ?? null;
  const invalid = message.grounding?.invalidCitations ?? 0;
  const content = message.content ?? '';
  const checks: RuleCheck[] = [
    {
      name: 'citations_valid',
      passed: invalid === 0,
      severity: 'fail',
      detail: invalid ? `${invalid} citation(s) referenced sources that were not provided` : undefined,
    },
    {
      name: 'grounded_answer_is_cited',
      passed: status !== 'grounded' || cited.length > 0,
      severity: 'fail',
    },
    {
      name: 'insufficient_answer_is_brief',
      // An "insufficient evidence" reply that runs long is probably answering anyway.
      passed: status !== 'insufficient' || content.length <= 1400,
      severity: 'warn',
    },
    {
      name: 'general_answer_uncited',
      passed: status !== 'general' || cited.length === 0,
      severity: 'fail',
    },
    {
      name: 'no_control_markers_leaked',
      passed: !/\[\[[A-Z_ -]+(:|\]\])/.test(content),
      severity: 'fail',
    },
    {
      name: 'flagged_source_not_cited',
      passed: !cited.some((s) => s.flagged),
      severity: 'warn',
      detail: 'Cited a passage that contains instruction-like text',
    },
    { name: 'has_followups', passed: message.suggestions.length > 0 || status === 'insufficient', severity: 'warn' },
    { name: 'answer_length_reasonable', passed: content.length >= 20 && content.length <= 6000, severity: 'warn' },
    {
      name: 'ttft_within_slo',
      passed: message.metrics?.ttftMs == null || message.metrics.ttftMs <= TTFT_SLO_MS,
      severity: 'warn',
      detail: message.metrics?.ttftMs != null ? `${message.metrics.ttftMs} ms` : undefined,
    },
    {
      name: 'latency_within_slo',
      passed: message.metrics?.latencyMs == null || message.metrics.latencyMs <= LATENCY_SLO_MS,
      severity: 'warn',
    },
    { name: 'not_degraded', passed: !message.grounding?.degraded, severity: 'warn' },
  ];
  return checks;
}

export function verdictOf(checks: RuleCheck[]) {
  if (checks.some((c) => !c.passed && c.severity === 'fail')) return 'fail' as const;
  if (checks.some((c) => !c.passed)) return 'warn' as const;
  return 'pass' as const;
}

export async function evaluateTutorRules(message: IMessage, question: string) {
  if (message.role !== 'assistant' || message.status === 'error') return null;
  const checks = tutorRuleChecks(message);
  const verdict = verdictOf(checks);
  const citedCount = message.sources.filter((s) => s.cited).length;
  const invalid = message.grounding?.invalidCitations ?? 0;
  return recordEvaluation({
    subjectType: 'tutor_message',
    subjectId: message._id,
    evaluator: 'rules',
    feature: 'tutor.answer',
    ownerId: message.ownerId,
    projectId: message.projectId,
    scores: {
      citationValidity: citedCount + invalid === 0 ? 1 : citedCount / (citedCount + invalid),
      groundingConsistency: checks.filter((c) => ['grounded_answer_is_cited', 'general_answer_uncited', 'insufficient_answer_is_brief'].includes(c.name)).every((c) => c.passed) ? 1 : 0,
      formatCompliance: checks.filter((c) => ['no_control_markers_leaked', 'has_followups', 'answer_length_reasonable'].includes(c.name)).every((c) => c.passed) ? 1 : 0,
      latencyOk: checks.filter((c) => c.name.endsWith('_slo')).every((c) => c.passed) ? 1 : 0,
      passRate: checks.filter((c) => c.passed).length / checks.length,
    },
    verdict,
    flags: checks.filter((c) => !c.passed).map((c) => c.name),
    rationale: checks
      .filter((c) => !c.passed)
      .map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`)
      .join('; ') || null,
    inputPreview: question,
    outputPreview: message.content,
    promptVersion: message.promptVersion,
    model: message.metrics?.model ?? null,
  });
}
