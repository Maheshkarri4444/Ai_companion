import { z } from 'zod';
import { ai } from '../../ai';
import { TUTOR_JUDGE_PROMPT } from '../../ai/prompts/evaluation';
import { JobError } from '../../jobs/queue';
import { escapePromptData, truncate } from '../../lib/text';
import { toObjectId } from '../../lib/validation';
import { Chunk, MaterialPage } from '../../models/knowledge.model';
import { Message } from '../../models/message.model';
import { stripCitations } from '../tutor/citations';
import { recordEvaluation } from './evaluation.service';

const Judgement = z.object({
  groundedness: z.number().int().min(1).max(5),
  citationAccuracy: z.number().int().min(1).max(5),
  relevance: z.number().int().min(1).max(5),
  pedagogy: z.number().int().min(1).max(5),
  insufficientHandling: z.enum(['correct', 'incorrect', 'n/a']),
  unsupportedClaims: z.array(z.string()),
  verdict: z.enum(['pass', 'warn', 'fail']),
  rationale: z.string(),
});

const norm = (score: number) => (score - 1) / 4;

/**
 * LLM-as-judge for one Tutor answer (sampled + every thumbs-down). Re-reads the full evidence the answer
 * was given, so groundedness and citation correctness are judged against exactly what the Tutor saw.
 */
export async function judgeTutorMessage(messageId: string, ctx: { jobId: string; signal: AbortSignal }) {
  const message = await Message.findById(toObjectId(messageId)).lean();
  if (!message || message.role !== 'assistant') return { skipped: 'message-deleted' };
  if (message.status !== 'complete') return { skipped: `status-${message.status}` };
  const question = message.replyTo ? await Message.findOne({ _id: message.replyTo, ownerId: message.ownerId }, { content: 1 }).lean() : null;
  if (!question) return { skipped: 'question-missing' };

  // Conversational turns have nothing to ground; rules already cover them.
  if (message.grounding?.status === 'conversational') return { skipped: 'conversational' };

  const chunkIds = message.sources.filter((s) => s.kind === 'chunk' && s.chunkId).map((s) => s.chunkId!);
  const chunks = await Chunk.find({ _id: { $in: chunkIds }, ownerId: message.ownerId }, { text: 1 }).lean();
  const textById = new Map(chunks.map((c) => [c._id.toString(), c.text]));
  const blocks: string[] = [];
  for (const s of message.sources) {
    let text = s.chunkId ? textById.get(s.chunkId.toString()) : undefined;
    if (!text && s.kind === 'page') {
      text = (await MaterialPage.findOne({ materialId: s.materialId, ownerId: message.ownerId, pageNumber: s.pageStart }, { text: 1 }).lean())?.text;
    }
    text ??= s.snippet;
    const usedByAnswer = message.grounding?.status === 'insufficient' ? ' (closest passage, not used)' : '';
    blocks.push(`[${s.ref}] ${s.materialTitle}, page ${s.pageStart}${usedByAnswer}\n${escapePromptData(truncate(text, 2000))}`);
  }

  const result = await ai().structured({
    feature: 'eval.judge',
    // A judge must be at least as capable as the model it grades; the light tier rated almost everything 5/5.
    tier: 'primary',
    reasoning: 'low',
    promptVersion: TUTOR_JUDGE_PROMPT.version,
    system: TUTOR_JUDGE_PROMPT.system,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: TUTOR_JUDGE_PROMPT.build({
              question: escapePromptData(truncate(question.content, 2000)),
              intent: message.intent ?? 'question',
              sources: blocks.join('\n\n'),
              answer: escapePromptData(truncate(message.content, 6000)),
              status: message.grounding?.status ?? 'unknown',
            }),
          },
        ],
      },
    ],
    schema: Judgement,
    meta: { ownerId: message.ownerId.toString(), projectId: message.projectId.toString(), messageId, jobId: ctx.jobId },
    signal: ctx.signal,
    timeoutMs: 45_000,
    inputPreview: `Judge: ${truncate(question.content, 200)}`,
  });
  const j = result.data;
  const flags: string[] = [];
  if (j.insufficientHandling === 'incorrect') flags.push('insufficient_mishandled');
  if (j.unsupportedClaims.length) flags.push('unsupported_claims');
  if (j.citationAccuracy <= 2) flags.push('citation_mismatch');
  if (j.groundedness <= 2) flags.push('ungrounded');

  const evaluation = await recordEvaluation({
    subjectType: 'tutor_message',
    subjectId: message._id,
    evaluator: 'llm_judge',
    feature: 'tutor.answer',
    ownerId: message.ownerId,
    projectId: message.projectId,
    scores: {
      groundedness: norm(j.groundedness),
      citationAccuracy: norm(j.citationAccuracy),
      relevance: norm(j.relevance),
      pedagogy: norm(j.pedagogy),
      ...(j.insufficientHandling === 'n/a' ? {} : { unsupportedHandling: j.insufficientHandling === 'correct' ? 1 : 0 }),
    },
    verdict: j.verdict,
    flags,
    rationale: [truncate(j.rationale, 400), ...j.unsupportedClaims.slice(0, 5).map((c) => `Unsupported: "${truncate(c, 160)}"`)].join(' | '),
    inputPreview: question.content,
    outputPreview: stripCitations(message.content),
    aiCallId: result.aiCallId,
    promptVersion: message.promptVersion,
    model: message.metrics?.model ?? null,
  });
  if (!evaluation) throw new JobError('EVAL_NOT_RECORDED', 'Evaluation could not be stored', true);
  return { verdict: j.verdict, groundedness: j.groundedness, citationAccuracy: j.citationAccuracy };
}
