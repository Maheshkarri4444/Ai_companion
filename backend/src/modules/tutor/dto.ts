import type { IConversation } from '../../models/conversation.model';
import type { IMessage, IMessageSource } from '../../models/message.model';

export function toSourceDto(s: IMessageSource) {
  return {
    ref: s.ref,
    kind: s.kind,
    materialId: s.materialId.toString(),
    materialTitle: s.materialTitle,
    pageStart: s.pageStart,
    pageEnd: s.pageEnd,
    sectionTitle: s.sectionTitle ?? null,
    snippet: s.snippet,
    score: s.score ?? null,
    origin: s.origin,
    cited: Boolean(s.cited),
    flagged: Boolean(s.flagged),
  };
}
export type SourceDto = ReturnType<typeof toSourceDto>;

export function toConversationDto(c: IConversation) {
  return {
    id: c._id.toString(),
    projectId: c.projectId.toString(),
    title: c.title,
    titleSource: c.titleSource,
    messageCount: c.messageCount,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    hasSummary: Boolean(c.summary?.text),
    createdAt: c.createdAt,
  };
}
export type ConversationDto = ReturnType<typeof toConversationDto>;

export function toMessageDto(m: IMessage) {
  const sources = (m.sources ?? []).map(toSourceDto);
  return {
    id: m._id.toString(),
    conversationId: m.conversationId.toString(),
    role: m.role,
    content: m.content,
    status: m.status,
    /** User messages: the learner's own idempotency key (lets the UI retry a failed question safely). */
    clientMessageId: m.role === 'user' ? (m.clientMessageId ?? null) : null,
    /** Assistant messages: the question they answer. */
    replyTo: m.replyTo?.toString() ?? null,
    mode: m.mode,
    action: m.action ?? null,
    intent: m.intent ?? null,
    grounding: m.role === 'assistant'
      ? {
          status: m.grounding?.status ?? null,
          sufficiency: m.grounding?.sufficiency ?? null,
          topScore: m.grounding?.topScore ?? null,
          invalidCitations: m.grounding?.invalidCitations ?? 0,
          degraded: Boolean(m.grounding?.degraded),
        }
      : null,
    sources,
    /** The learner-facing "Source: Title — Page N" list: only sources the answer actually cites. */
    citations: sources.filter((s) => s.cited).map(({ ref, materialId, materialTitle, pageStart, pageEnd, sectionTitle }) => ({
      ref,
      materialId,
      materialTitle,
      pageStart,
      pageEnd,
      sectionTitle,
    })),
    suggestions: m.suggestions ?? [],
    toolCalls: (m.toolCalls ?? []).map((t) => ({ name: t.name, ok: t.ok, summary: t.summary, data: t.data ?? null })),
    feedback: m.feedback ? { rating: m.feedback.rating, reason: m.feedback.reason ?? null } : null,
    error: m.error ? { code: m.error.code, message: m.error.message } : null,
    metrics: m.role === 'assistant' ? { latencyMs: m.metrics?.latencyMs ?? null, ttftMs: m.metrics?.ttftMs ?? null, model: m.metrics?.model ?? null } : null,
    createdAt: m.createdAt,
  };
}
export type MessageDto = ReturnType<typeof toMessageDto>;
