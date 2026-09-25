import { Types } from 'mongoose';
import {
  ai,
  AIError,
  friendlyAIMessage,
  type AIContent,
  type AIFunctionCall,
  type AIPart,
  type CallMeta,
  type GatewayResult,
} from '../../ai';
import { TUTOR_PROMPT_VERSION, tutorSystemPrompt, type TutorRoute } from '../../ai/prompts/tutor';
import { config } from '../../config/env';
import { getContext } from '../../lib/context';
import { AppError, isDuplicateKeyError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { escapePromptData, truncate } from '../../lib/text';
import { Conversation, type IConversation } from '../../models/conversation.model';
import { Chunk, Concept, MaterialPage } from '../../models/knowledge.model';
import { Material } from '../../models/material.model';
import { Message, type GroundingStatus, type IMessage, type IToolCall, type MessageStatus } from '../../models/message.model';
import type { IProject } from '../../models/project.model';
import { User } from '../../models/user.model';
import { recordEvent } from '../activity/activity.service';
import { evaluateTutorRules } from '../evaluation/tutor-rules';
import { retrieve, type RetrievalResult } from '../knowledge/retrieval';
import { composeContext } from '../learning-context/providers';
import { getOwnedProject } from '../projects/projects.service';
import { touchActivity } from '../workspace';
import { MarkerStripper, resolveGrounding, stripCitations, validateCitations } from './citations';
import { toConversationDto, toMessageDto, toSourceDto, type ConversationDto, type MessageDto, type SourceDto } from './dto';
import { buildExtractiveFallback, buildInsufficientReply } from './insufficient';
import { SourceRegistry, type TurnSource } from './sources';
import { executeToolCall, tutorToolDeclarations, tutorToolLabel, type ToolContext } from './tools';
import { CONTINUATION_INTENTS, understand, type HistoryTurn, type TutorAction, type Understanding } from './understand';

/*
 * The Tutor pipeline (PRD §6–§8, docs/ARCHITECTURE.md §14):
 *   prepare  — ownership, idempotency (clientMessageId), persist the question + an assistant placeholder
 *   execute  — understand → compose learner context ∥ retrieve evidence → evidence gate →
 *              stream the answer (tool loop) → validate citations → persist → events → background workflows
 * The model only ever sees data inside delimiters; everything it can do goes through validated tools.
 */

export type TutorEvent =
  | { type: 'start'; conversation: ConversationDto; userMessage: MessageDto; assistantMessageId: string; replay: boolean }
  | { type: 'status'; stage: 'understanding' | 'retrieving' | 'thinking' | 'searching' | 'writing'; label: string }
  | { type: 'sources'; sources: SourceDto[] }
  | { type: 'tool'; name: string; status: 'started' | 'finished' | 'failed'; summary: string }
  | { type: 'delta'; text: string }
  /** The model failed mid-answer; discard the partial text — the answer restarts on another model. */
  | { type: 'reset'; reason: string }
  | { type: 'done'; message: MessageDto; conversation: ConversationDto }
  | { type: 'error'; code: string; message: string };

export type Emit = (event: TutorEvent) => void;

export interface TurnRequest {
  ownerId: string;
  projectId: string;
  conversationId?: string;
  clientMessageId: string;
  content: string;
  mode: 'auto' | 'general';
  action: TutorAction | null;
}

interface RunTurn {
  kind: 'run';
  project: IProject;
  conversation: IConversation;
  userMessage: IMessage;
  assistantId: Types.ObjectId;
  request: TurnRequest;
  learnerName: string | null;
}
interface ReplayTurn {
  kind: 'replay';
  conversation: IConversation;
  userMessage: IMessage;
  assistantMessage: IMessage;
}
export type PreparedTurn = RunTurn | ReplayTurn;

const HISTORY_MESSAGES = 8;
const HISTORY_MESSAGE_CHARS = 1500;
const HISTORY_BUDGET_CHARS = 7000;
const MAX_TOOL_ROUNDS = 2;
const MAX_CALLS_PER_ROUND = 4;
/** A placeholder still "streaming" after this long belongs to a crashed request. */
export const STALE_STREAM_MS = 3 * 60_000;

/* ───────────────────────────── Active turns (Stop) ───────────────────────────── */

const activeTurns = new Map<string, { ownerId: string; controller: AbortController }>();

export function trackActiveTurn(messageId: string, ownerId: string, controller: AbortController) {
  activeTurns.set(messageId, { ownerId, controller });
  return () => activeTurns.delete(messageId);
}

/** Stops a running answer on this instance; the partial answer is kept as "stopped". */
export function stopActiveTurn(ownerId: string, messageId: string): boolean {
  const turn = activeTurns.get(messageId);
  if (!turn || turn.ownerId !== ownerId) return false;
  turn.controller.abort(new AIError('aborted', 'Stopped by the learner'));
  return true;
}

/* ─────────────────────────────────── Prepare ─────────────────────────────────── */

function titleFrom(content: string) {
  const firstLine = content.replace(/\s+/g, ' ').trim();
  const title = truncate(firstLine, 60).replace(/[?.!,;:\s]+$/, '');
  return title || 'New conversation';
}

async function learnerFirstName(ownerId: Types.ObjectId) {
  const user = await User.findById(ownerId, { name: 1 }).lean();
  return user?.name?.split(/\s+/)[0]?.slice(0, 40) ?? null;
}

/**
 * Validates ownership and makes sends idempotent: a retried request with the same clientMessageId replays
 * the stored answer (complete), is rejected while still running, or re-answers the same question (failed).
 */
export async function prepareTurn(request: TurnRequest): Promise<PreparedTurn> {
  const project = await getOwnedProject(request.ownerId, request.projectId);
  const owner = project.ownerId;

  const existing = await Message.findOne({ ownerId: owner, clientMessageId: request.clientMessageId }).lean();
  if (existing) {
    if (!existing.projectId.equals(project._id)) throw AppError.conflict('CLIENT_ID_REUSED', 'This message id was already used.');
    const conversation = await Conversation.findOne({ _id: existing.conversationId, ownerId: owner }).lean();
    if (!conversation) throw AppError.notFound('Conversation');
    const reply = await Message.findOne({ replyTo: existing._id, ownerId: owner }).sort({ createdAt: -1 }).lean();
    if (reply?.status === 'complete') return { kind: 'replay', conversation, userMessage: existing, assistantMessage: reply };
    if (reply?.status === 'streaming' && Date.now() - new Date(reply.updatedAt).getTime() < STALE_STREAM_MS) {
      throw AppError.conflict('IN_PROGRESS', 'Zoya is still answering this message.');
    }
    // Stopped / failed / abandoned: answer the same question again, replacing the unfinished reply.
    await Message.deleteMany({ replyTo: existing._id, ownerId: owner, status: { $ne: 'complete' } });
    const assistantId = new Types.ObjectId();
    await Message.create({
      _id: assistantId,
      conversationId: conversation._id,
      ownerId: owner,
      projectId: project._id,
      role: 'assistant',
      status: 'streaming',
      replyTo: existing._id,
      mode: existing.mode,
      action: existing.action,
    });
    return {
      kind: 'run',
      project,
      conversation,
      userMessage: existing,
      assistantId,
      learnerName: await learnerFirstName(owner),
      request: { ...request, content: existing.content, mode: existing.mode, action: (existing.action as TutorAction | null) ?? null },
    };
  }

  let conversation: IConversation;
  let createdConversation = false;
  if (request.conversationId) {
    const found = await Conversation.findOne({
      _id: new Types.ObjectId(request.conversationId),
      ownerId: owner,
      projectId: project._id,
    }).lean();
    if (!found) throw AppError.notFound('Conversation');
    conversation = found;
  } else {
    conversation = (
      await Conversation.create({
        ownerId: owner,
        spaceId: project.spaceId,
        projectId: project._id,
        title: titleFrom(request.content),
        titleSource: 'auto',
        lastMessageAt: new Date(),
      })
    ).toObject();
    createdConversation = true;
  }

  let userMessage: IMessage;
  try {
    userMessage = (
      await Message.create({
        conversationId: conversation._id,
        ownerId: owner,
        projectId: project._id,
        role: 'user',
        content: request.content,
        clientMessageId: request.clientMessageId,
        status: 'complete',
        mode: request.mode,
        action: request.action,
      })
    ).toObject();
  } catch (err) {
    if (createdConversation) await Conversation.deleteOne({ _id: conversation._id });
    if (isDuplicateKeyError(err)) throw AppError.conflict('IN_PROGRESS', 'This message is already being answered.');
    throw err;
  }

  const assistantId = new Types.ObjectId();
  await Message.create({
    _id: assistantId,
    conversationId: conversation._id,
    ownerId: owner,
    projectId: project._id,
    role: 'assistant',
    status: 'streaming',
    replyTo: userMessage._id,
    mode: request.mode,
    action: request.action,
  });
  const updated = await Conversation.findOneAndUpdate(
    { _id: conversation._id },
    { $inc: { messageCount: 1 }, $set: { lastMessageAt: new Date(), lastMessagePreview: truncate(request.content, 160) } },
    { returnDocument: 'after' },
  ).lean();

  return {
    kind: 'run',
    project,
    conversation: updated ?? conversation,
    userMessage,
    assistantId,
    learnerName: await learnerFirstName(owner),
    request,
  };
}

/** Replays a stored answer through the same event protocol as a live one. */
export function replayTurn(turn: ReplayTurn, emit: Emit): MessageDto {
  const message = toMessageDto(turn.assistantMessage);
  emit({
    type: 'start',
    conversation: toConversationDto(turn.conversation),
    userMessage: toMessageDto(turn.userMessage),
    assistantMessageId: message.id,
    replay: true,
  });
  emit({ type: 'done', message, conversation: toConversationDto(turn.conversation) });
  return message;
}

/* ─────────────────────────────────── Helpers ─────────────────────────────────── */

async function loadHistory(conversation: IConversation, before: Date): Promise<{ turns: HistoryTurn[]; messages: IMessage[] }> {
  const messages = await Message.find({
    conversationId: conversation._id,
    ownerId: conversation.ownerId,
    createdAt: { $lt: before },
    status: { $in: ['complete', 'stopped'] },
  })
    .sort({ createdAt: -1 })
    .limit(HISTORY_MESSAGES)
    .lean();
  const turns: HistoryTurn[] = [];
  let used = 0;
  for (const m of messages) {
    const text = truncate(m.role === 'assistant' ? stripCitations(m.content) : m.content, HISTORY_MESSAGE_CHARS);
    if (!text.trim()) continue;
    if (used + text.length > HISTORY_BUDGET_CHARS) break;
    used += text.length;
    turns.unshift({ role: m.role, content: text });
  }
  return { turns, messages: messages.reverse() };
}

/** Follow-ups ("explain that simpler") keep the evidence the previous answer relied on. */
async function loadCarriedSources(previous: IMessage, owner: Types.ObjectId): Promise<Array<Omit<TurnSource, 'ref'>>> {
  const cited = previous.sources.filter((s) => s.cited);
  const picked = (cited.length ? cited : previous.sources.filter((s) => s.origin !== 'carried' || s.cited)).slice(0, 4);
  if (picked.length === 0) return [];
  const chunkIds = picked.filter((s) => s.kind === 'chunk' && s.chunkId).map((s) => s.chunkId as Types.ObjectId);
  const chunks = chunkIds.length ? await Chunk.find({ _id: { $in: chunkIds }, ownerId: owner }, { text: 1 }).lean() : [];
  const chunkText = new Map(chunks.map((c) => [c._id.toString(), c.text]));
  const out: Array<Omit<TurnSource, 'ref'>> = [];
  for (const s of picked) {
    let text: string | undefined;
    if (s.kind === 'chunk' && s.chunkId) text = chunkText.get(s.chunkId.toString());
    else {
      const page = await MaterialPage.findOne({ materialId: s.materialId, ownerId: owner, pageNumber: s.pageStart }, { text: 1 }).lean();
      text = page?.text;
    }
    if (!text) continue; // the material was deleted since
    out.push({
      kind: s.kind,
      chunkId: s.chunkId?.toString() ?? null,
      materialId: s.materialId.toString(),
      materialTitle: s.materialTitle,
      pageStart: s.pageStart,
      pageEnd: s.pageEnd,
      sectionTitle: s.sectionTitle ?? null,
      text,
      score: s.score ?? null,
      origin: 'carried',
      flagged: s.flagged,
    });
  }
  return out;
}

async function topConcepts(project: IProject) {
  const concepts = await Concept.find({ ownerId: project.ownerId, projectId: project._id }, { name: 1 })
    .sort({ importance: -1, chunkCount: -1 })
    .limit(12)
    .lean();
  return concepts.map((c) => c.name);
}

async function materialCounts(project: IProject) {
  const rows = await Material.aggregate<{ _id: string; n: number }>([
    { $match: { ownerId: project.ownerId, projectId: project._id } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const by = new Map(rows.map((r) => [r._id, r.n]));
  return { ready: by.get('ready') ?? 0, pending: (by.get('queued') ?? 0) + (by.get('processing') ?? 0) };
}

const TURN_INSTRUCTION: Record<TutorRoute, string> = {
  grounded:
    'Answer the request above using only the evidence in <sources>, following your evidence rules and the teaching style for its intent. Start with the status marker, cite [S#] right after supported sentences, and end with the [[FOLLOWUPS: …]] line.',
  general: 'Answer the request above from general knowledge as instructed: start with [[GENERAL]] and end with the [[FOLLOWUPS: …]] line.',
  chat: "Reply to the learner's message above as instructed: start with [[CHAT]] and end with the [[FOLLOWUPS: …]] line.",
};

function buildContents(
  turns: HistoryTurn[],
  input: { route: TutorRoute; context: string; summary: string | null; sources: string | null; intent: string; content: string },
): AIContent[] {
  const contents: AIContent[] = [];
  for (const turn of turns) {
    const role = turn.role === 'user' ? 'user' : 'model';
    const text = role === 'user' ? escapePromptData(turn.content) : turn.content;
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push({ text });
    else contents.push({ role, parts: [{ text }] });
  }
  while (contents[0]?.role === 'model') contents.shift(); // conversations must start with the learner

  const blocks: string[] = [];
  if (input.context) blocks.push(`<learner_context>\n${input.context}\n</learner_context>`);
  if (input.summary) blocks.push(`<conversation_summary>\n${escapePromptData(truncate(input.summary, 1500))}\n</conversation_summary>`);
  if (input.sources) blocks.push(input.sources);
  blocks.push(`<request intent="${input.intent}">\n${escapePromptData(input.content)}\n</request>`);
  blocks.push(TURN_INSTRUCTION[input.route]);
  const text = blocks.join('\n\n');

  const last = contents.at(-1);
  if (last?.role === 'user') last.parts.push({ text });
  else contents.push({ role: 'user', parts: [{ text }] });
  return contents;
}

/* ─────────────────────────────────── Execute ─────────────────────────────────── */

type Outcome = { status: MessageStatus; error?: { code: string; message: string } };

export async function executeTurn(turn: RunTurn, emit: Emit, signal: AbortSignal): Promise<MessageDto> {
  const started = Date.now();
  const { project, conversation, userMessage, assistantId, request } = turn;
  const ownerId = project.ownerId.toString();
  const projectId = project._id.toString();
  const meta: CallMeta = {
    ownerId,
    projectId,
    conversationId: conversation._id.toString(),
    messageId: assistantId.toString(),
    traceId: getContext()?.requestId ?? null,
  };

  const sources = new SourceRegistry();
  let stripper = new MarkerStripper();
  const state = {
    content: '',
    citedRefs: [] as string[],
    invalidCitations: 0,
    suggestions: [] as string[],
    toolCalls: [] as IToolCall[],
    flags: [] as string[],
    aiCallIds: [] as string[],
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0 },
    model: null as string | null,
    fallbackUsed: false,
    rounds: 0,
    ttftMs: null as number | null,
    understandMs: null as number | null,
    retrieveMs: null as number | null,
    generateMs: null as number | null,
    route: 'grounded' as TutorRoute,
    grounding: null as GroundingStatus | null,
    degraded: false,
    carried: 0,
    promptVersion: null as string | null,
  };
  let understanding: Understanding | null = null;
  let retrieval: RetrievalResult | null = null;
  let contextTrace: unknown = null;
  let announcedWriting = false;

  const sourceDtos = () => sources.toDocuments(new Set()).map(toSourceDto);
  const write = (text: string) => {
    if (!text) return;
    if (!announcedWriting) {
      announcedWriting = true;
      emit({ type: 'status', stage: 'writing', label: 'Writing' });
    }
    if (state.ttftMs === null) state.ttftMs = Date.now() - started;
    state.content += text;
    emit({ type: 'delta', text });
  };
  const track = (result: GatewayResult) => {
    state.aiCallIds.push(result.aiCallId);
    state.usage.inputTokens += result.usage.inputTokens;
    state.usage.outputTokens += result.usage.outputTokens;
    state.usage.thinkingTokens += result.usage.thinkingTokens;
    state.usage.costUsd += result.costUsd;
    state.model = result.model;
    state.fallbackUsed ||= result.fallbackUsed;
  };
  const postProcess = () => {
    const citation = validateCitations(state.content, sources.refs());
    state.content = citation.content;
    state.citedRefs = citation.citedRefs;
    state.invalidCitations = citation.invalidRefs.length;
    if (citation.invalidRefs.length) state.flags.push('invalid_citations_removed');
    const resolved = resolveGrounding({ route: state.route, reported: stripper.status(), citedCount: citation.citedRefs.length });
    state.grounding = resolved.status;
    state.flags.push(...resolved.flags);
  };

  emit({
    type: 'start',
    conversation: toConversationDto(conversation),
    userMessage: toMessageDto(userMessage),
    assistantMessageId: assistantId.toString(),
    replay: false,
  });

  const run = async (): Promise<Outcome> => {
    const [history, concepts] = await Promise.all([loadHistory(conversation, userMessage.createdAt), topConcepts(project)]);
    const previousAssistant = [...history.messages].reverse().find((m) => m.role === 'assistant') ?? null;

    // 1. Understand the request
    emit({ type: 'status', stage: 'understanding', label: 'Understanding your question' });
    const t1 = Date.now();
    understanding = await understand({
      message: request.content,
      action: request.action,
      history: history.turns,
      summary: conversation.summary?.text ?? null,
      previousQuery: (previousAssistant?.trace?.standaloneQuery as string | undefined) ?? null,
      project: { name: project.name, goal: project.learningGoal },
      concepts,
      meta,
      signal,
    });
    state.understandMs = Date.now() - t1;
    if (understanding.aiCallId) state.aiCallIds.push(understanding.aiCallId);

    if (request.mode === 'general' || request.action === 'general_knowledge') state.route = 'general';
    else if (!understanding.needsMaterials) state.route = 'chat';
    const query = understanding.standaloneQuery || request.content;

    // 2. Identify Project context ∥ retrieve evidence
    if (state.route === 'grounded') emit({ type: 'status', stage: 'retrieving', label: 'Searching your materials' });
    const t2 = Date.now();
    const [retrieved, context] = await Promise.all([
      state.route === 'grounded' ? retrieve({ ownerId, projectId, query, limit: 6, meta, signal }) : Promise.resolve(null),
      composeContext({ ownerId, projectId, query, purpose: 'tutor', intent: understanding.intent, meta, signal }),
    ]);
    retrieval = retrieved;
    contextTrace = context.trace;

    // 3. Evidence gate
    if (state.route === 'grounded') {
      if (previousAssistant && CONTINUATION_INTENTS.has(understanding.intent)) {
        state.carried = sources.add(await loadCarriedSources(previousAssistant, project.ownerId)).length;
      }
      if (retrieval && retrieval.sufficiency !== 'none') sources.addRetrieved(retrieval.sources, 'retrieval');
      state.retrieveMs = Date.now() - t2;

      if (sources.size === 0) {
        const counts = await materialCounts(project);
        const nearest = retrieval?.sources[0] ?? null;
        const reply = buildInsufficientReply({
          projectName: project.name,
          readyMaterials: counts.ready,
          pendingMaterials: counts.pending,
          concepts,
          nearest,
        });
        // Shown to the learner as "closest passages" — never cited.
        if (retrieval?.sources.length) sources.addRetrieved(retrieval.sources.slice(0, 3), 'retrieval');
        write(reply.content);
        state.grounding = 'insufficient';
        state.suggestions = reply.suggestions;
        state.flags.push(`insufficient_${reply.reason}`);
        state.promptVersion = 'insufficient.v1';
        return { status: 'complete' };
      }
      emit({ type: 'sources', sources: sourceDtos() });
    } else {
      state.retrieveMs = Date.now() - t2;
    }

    // 4. Generate (streaming, with controlled tool use)
    emit({ type: 'status', stage: 'thinking', label: state.route === 'grounded' ? 'Reading the evidence' : 'Thinking' });
    const t3 = Date.now();
    state.promptVersion = TUTOR_PROMPT_VERSION;
    const system = tutorSystemPrompt(state.route, { projectName: project.name, learnerName: turn.learnerName });
    const contents = buildContents(history.turns, {
      route: state.route,
      context: context.text,
      summary: conversation.summary?.text ?? null,
      sources: state.route === 'grounded' ? sources.toPrompt() : null,
      intent: understanding.intent,
      content: request.content,
    });
    const declarations = state.route === 'grounded' ? tutorToolDeclarations() : [];
    const toolContext: ToolContext = {
      ownerId,
      projectId,
      conversationId: conversation._id.toString(),
      messageId: assistantId.toString(),
      sources,
      meta,
      signal,
      usage: new Map(),
    };

    const generate = async (contents: AIContent[]) => {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        state.rounds += 1;
        const tools = declarations.length && round < MAX_TOOL_ROUNDS ? declarations : undefined;
        const calls: AIFunctionCall[] = [];
        let result: GatewayResult | null = null;
        for await (const event of ai().stream({
          feature: 'tutor.answer',
          tier: state.route === 'chat' ? 'light' : 'primary',
          system,
          contents,
          tools,
          reasoning: config.AI_TUTOR_REASONING,
          maxOutputTokens: 4096,
          promptVersion: TUTOR_PROMPT_VERSION,
          meta,
          signal,
          // Time to first token per model attempt: a model that has not started within 15 s is skipped for
          // the next one in the chain (minimal reasoning normally starts streaming in 1–4 s).
          timeoutMs: 15_000,
          inputPreview: request.content,
          metadata: { round, route: state.route, intent: understanding!.intent, sources: sources.size },
        })) {
          if (event.type === 'text') write(stripper.push(event.text));
          else if (event.type === 'function_call') calls.push(event.call);
          else result = event.result;
        }
        if (result) track(result);
        if (calls.length === 0 || !tools || !result) break;

        // The model asked for application data: validate, authorise, execute, return, continue.
        contents.push({ role: 'model', parts: result.parts });
        const before = sources.size;
        const responses: AIPart[] = [];
        for (const [i, call] of calls.entries()) {
          if (i >= MAX_CALLS_PER_ROUND) {
            responses.push({ functionResponse: { id: call.id, name: call.name, response: { error: 'Too many tool calls in one step.' } } });
            continue;
          }
          emit({ type: 'tool', name: call.name, status: 'started', summary: tutorToolLabel(call.name) });
          emit({ type: 'status', stage: 'searching', label: tutorToolLabel(call.name) });
          const { response, record } = await executeToolCall(call, toolContext);
          state.toolCalls.push(record);
          emit({ type: 'tool', name: call.name, status: record.ok ? 'finished' : 'failed', summary: record.summary });
          responses.push({ functionResponse: { id: call.id, name: call.name, response } });
        }
        contents.push({ role: 'user', parts: responses });
        if (sources.size !== before) emit({ type: 'sources', sources: sourceDtos() });
      }
    };

    // Failures before the first token are handled by the gateway (retry / next model). A model that dies
    // mid-answer cannot be resumed, so the answer restarts once — its breaker is open now, so another model
    // takes over — and the client is told to discard the partial text.
    for (let restart = 0; ; restart++) {
      try {
        await generate(structuredClone(contents));
        break;
      } catch (err) {
        const transient = err instanceof AIError && ['unavailable', 'rate_limited', 'timeout', 'unknown'].includes(err.kind);
        if (!transient || restart >= 1 || signal.aborted || !state.content) throw err;
        state.flags.push(`restarted_after_${(err as AIError).kind}`);
        state.content = '';
        stripper = new MarkerStripper();
        emit({ type: 'reset', reason: 'The answer was interrupted — Zoya is starting again.' });
      }
    }
    write(stripper.flush());
    state.generateMs = Date.now() - t3;

    postProcess();
    state.suggestions = stripper.followUps();
    if (!state.content.trim()) throw new AIError('invalid_output', 'The model returned an empty answer.');
    return { status: 'complete' };
  };

  let outcome: Outcome;
  try {
    outcome = await run();
  } catch (err) {
    if (signal.aborted) {
      // Stopped by the learner (or the connection closed): keep what was already written.
      state.content += stripper.flush();
      postProcess();
      state.flags.push('stopped');
      outcome = { status: 'stopped' };
    } else {
      const aiError = err instanceof AIError ? err : null;
      logger.warn({ err: (err as Error).message, kind: aiError?.kind, messageId: assistantId.toString() }, 'Tutor turn failed');
      if (aiError && !state.content.trim() && state.route === 'grounded' && sources.size > 0) {
        // Graceful degradation: the evidence exists, so show it (cited) rather than an error.
        write(buildExtractiveFallback(sources.all()));
        postProcess();
        state.grounding = 'partial';
        state.degraded = true;
        state.flags.push('ai_unavailable_extractive');
        outcome = { status: 'complete' };
      } else {
        if (state.content.trim()) postProcess();
        outcome = {
          status: 'error',
          error: {
            code: aiError ? `AI_${aiError.kind.toUpperCase()}` : 'TUTOR_ERROR',
            message: aiError ? friendlyAIMessage(aiError.kind) : 'Something went wrong while answering. Please try again.',
          },
        };
      }
    }
  }

  // 5. Persist, answer, then run side effects (the learner never waits for them).
  const u = understanding as Understanding | null;
  const r = retrieval as RetrievalResult | null;
  const saved = await Message.findOneAndUpdate(
    { _id: assistantId },
    {
      $set: {
        content: state.content,
        status: outcome.status,
        intent: u?.intent ?? null,
        grounding: {
          status: state.grounding,
          sufficiency: r?.sufficiency ?? null,
          topScore: r?.topScore ?? null,
          method: r?.method ?? null,
          invalidCitations: state.invalidCitations,
          degraded: state.degraded,
        },
        sources: sources.toDocuments(new Set(state.citedRefs)),
        suggestions: state.suggestions,
        toolCalls: state.toolCalls,
        error: outcome.error ?? null,
        metrics: {
          latencyMs: Date.now() - started,
          ttftMs: state.ttftMs,
          understandMs: state.understandMs,
          retrieveMs: state.retrieveMs,
          generateMs: state.generateMs,
          rounds: state.rounds,
          ...state.usage,
          costUsd: Math.round(state.usage.costUsd * 1e8) / 1e8,
          model: state.model,
          fallbackUsed: state.fallbackUsed,
        },
        trace: {
          route: state.route,
          intent: u?.intent ?? null,
          understandMethod: u?.method ?? null,
          standaloneQuery: u?.standaloneQuery ?? null,
          retrieval: r?.trace ?? null,
          context: contextTrace,
          carriedSources: state.carried,
          sourceCount: sources.size,
          flags: state.flags,
        },
        aiCallIds: state.aiCallIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)),
        promptVersion: state.promptVersion,
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!saved) throw AppError.notFound('Message');

  const messageCount = await Message.countDocuments({ conversationId: conversation._id });
  const updatedConversation =
    (await Conversation.findOneAndUpdate(
      { _id: conversation._id },
      {
        $set: {
          messageCount,
          lastMessageAt: new Date(),
          lastMessagePreview: truncate(stripCitations(state.content).replace(/\s+/g, ' ') || request.content, 160),
        },
      },
      { returnDocument: 'after' },
    ).lean()) ?? conversation;

  const dto = toMessageDto(saved);
  emit({ type: 'done', message: dto, conversation: toConversationDto(updatedConversation) });

  void afterTurn(project, saved, request, updatedConversation).catch((err) =>
    logger.warn({ err: (err as Error).message }, 'Tutor post-processing failed'),
  );
  return dto;
}

/** Evaluation + event (which triggers memory, summary and judge workflows). Never blocks the answer. */
async function afterTurn(project: IProject, message: IMessage, request: TurnRequest, conversation: IConversation) {
  if (message.status === 'error') return;
  await touchActivity({ spaceId: project.spaceId, projectId: project._id });
  const rules = await evaluateTutorRules(message, request.content);
  await recordEvent({
    type: 'tutor.answered',
    ownerId: project.ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    metadata: {
      projectName: project.name,
      conversationId: conversation._id.toString(),
      conversationTitle: conversation.title,
      messageId: message._id.toString(),
      question: truncate(request.content, 120),
      grounding: message.grounding?.status ?? null,
      intent: message.intent,
      citationCount: message.sources.filter((s) => s.cited).length,
      messageCount: conversation.messageCount,
      rulesVerdict: rules?.verdict ?? null,
      status: message.status,
    },
    eventKey: `tutor.answered:${message._id.toString()}`,
  });
}

/** Convenience for the evaluation suite and tests: prepare + execute (or replay) in one call. */
export async function runTutorTurn(request: TurnRequest, emit: Emit = () => undefined, signal = new AbortController().signal) {
  const turn = await prepareTurn(request);
  if (turn.kind === 'replay') return replayTurn(turn, emit);
  return executeTurn(turn, emit, signal);
}
