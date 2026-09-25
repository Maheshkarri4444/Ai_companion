import { z } from 'zod';
import { ai, AIError, type CallMeta } from '../../ai';
import { UNDERSTAND_PROMPT } from '../../ai/prompts/tutor';
import { escapePromptData, truncate } from '../../lib/text';
import { stripCitations } from './citations';

export const TUTOR_INTENTS = [
  'question',
  'follow_up',
  'simplify',
  'example',
  'check_understanding',
  'answer_check',
  'summarize',
  'revision',
  'explore',
  'conversational',
  'meta',
] as const;
export type TutorIntent = (typeof TUTOR_INTENTS)[number];

/** One-click actions in the Tutor UI. They map straight to an intent — no classification call needed. */
export const TUTOR_ACTIONS = ['simplify', 'example', 'check_understanding', 'summarize', 'revision', 'general_knowledge'] as const;
export type TutorAction = (typeof TUTOR_ACTIONS)[number];

/** Intents that continue the previous answer: its cited evidence is carried into this turn. */
export const CONTINUATION_INTENTS = new Set<TutorIntent>(['follow_up', 'simplify', 'example', 'check_understanding', 'answer_check']);

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface Understanding {
  intent: TutorIntent;
  /** Self-contained retrieval query (follow-ups resolved against the conversation). */
  standaloneQuery: string;
  needsMaterials: boolean;
  method: 'action' | 'heuristic' | 'model' | 'fallback';
  aiCallId: string | null;
  ms: number;
}

const Classification = z.object({
  intent: z.enum(TUTOR_INTENTS),
  standaloneQuery: z.string(), // truncated in done()
  needsMaterials: z.boolean(),
});

/** Small talk: opens with a greeting/thanks/acknowledgement and asks for nothing. */
const SMALL_TALK =
  /^(hi|hello|hey|hiya|yo|howdy|good (morning|afternoon|evening|night)|thanks|thank you|thank u|thx|ty|cheers|ok|okay|cool|great|nice|awesome|perfect|got it|bye|goodbye|see (you|ya)|you('re| are) (great|awesome|amazing|the best))\b/i;
const ASKS_SOMETHING =
  /\?|\b(what|why|how|when|where|which|explain|define|describe|compare|difference|example|quiz|test me|summari[sz]e|revise|teach|tell me|show me|help me (understand|learn|with|revise))\b/i;
const META = /^(who are you|what are you|what can you do|how (do|can) you help( me)?|how does this work|help)[\s?!.]*$/i;

const ACTION_INTENT: Record<Exclude<TutorAction, 'general_knowledge'>, TutorIntent> = {
  simplify: 'simplify',
  example: 'example',
  check_understanding: 'check_understanding',
  summarize: 'summarize',
  revision: 'revision',
};

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Step 1 of the Tutor pipeline ("Understand Request", PRD §7). Cheap paths first — UI actions, greetings and
 * first questions need no model call; only ambiguous follow-ups are sent to the light model, which also
 * rewrites them into a standalone query so retrieval finds the right evidence. Never fails the turn.
 */
export async function understand(input: {
  message: string;
  action: TutorAction | null;
  history: HistoryTurn[];
  summary: string | null;
  previousQuery: string | null;
  project: { name: string; goal: string };
  concepts: string[];
  meta: CallMeta;
  signal?: AbortSignal;
}): Promise<Understanding> {
  const started = Date.now();
  const done = (u: Omit<Understanding, 'ms' | 'aiCallId'>, aiCallId: string | null = null): Understanding => ({
    ...u,
    standaloneQuery: truncate(u.standaloneQuery.trim(), 400),
    aiCallId,
    ms: Date.now() - started,
  });
  const message = input.message.trim();
  const lastUser = [...input.history].reverse().find((t) => t.role === 'user')?.content ?? null;
  const topic = input.previousQuery ?? lastUser ?? '';

  if (input.action && input.action !== 'general_knowledge') {
    const intent = ACTION_INTENT[input.action];
    const fallbackTopic =
      intent === 'revision' || intent === 'summarize' ? `${input.project.goal} ${input.concepts.slice(0, 6).join(', ')}` : message;
    return done({ intent, standaloneQuery: topic || fallbackTopic, needsMaterials: true, method: 'action' });
  }
  if (META.test(message)) {
    return done({ intent: 'meta', standaloneQuery: '', needsMaterials: false, method: 'heuristic' });
  }
  if (wordCount(message) <= 12 && SMALL_TALK.test(message) && !ASKS_SOMETHING.test(message)) {
    return done({ intent: 'conversational', standaloneQuery: '', needsMaterials: false, method: 'heuristic' });
  }
  if (input.history.length === 0) {
    return done({ intent: 'question', standaloneQuery: message, needsMaterials: true, method: 'heuristic' });
  }

  const turns = input.history
    .slice(-4)
    .map((t) => `${t.role === 'user' ? 'Learner' : 'Tutor'}: ${escapePromptData(truncate(stripCitations(t.content).replace(/\s+/g, ' '), 450))}`)
    .join('\n');
  try {
    const result = await ai().structured({
      feature: 'tutor.intent',
      tier: 'light',
      promptVersion: UNDERSTAND_PROMPT.version,
      system: UNDERSTAND_PROMPT.system,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: UNDERSTAND_PROMPT.build({
                projectName: input.project.name,
                goal: truncate(input.project.goal, 300),
                concepts: input.concepts.slice(0, 15),
                summary: input.summary ? escapePromptData(truncate(input.summary, 1200)) : null,
                turns,
                message: escapePromptData(truncate(message, 2000)),
              }),
            },
          ],
        },
      ],
      schema: Classification,
      meta: input.meta,
      signal: input.signal,
      timeoutMs: 8000,
      maxOutputTokens: 300,
      inputPreview: message,
    });
    let { intent } = result.data;
    // The evidence gate must not be bypassable by classification: a message that asks for something is never
    // small talk, whatever the model says ("Who painted the Mona Lisa?" → retrieval → honest "not in your
    // materials"). Only genuine small talk / questions about Zoya skip retrieval.
    if ((intent === 'conversational' || intent === 'meta') && ASKS_SOMETHING.test(message) && !META.test(message)) intent = 'question';
    const conversational = intent === 'conversational' || intent === 'meta';
    return done(
      {
        intent,
        standaloneQuery: conversational ? '' : result.data.standaloneQuery.trim() || message,
        // Every subject request goes through retrieval: the evidence gate, not the classifier, decides
        // whether the materials can answer it.
        needsMaterials: !conversational,
        method: 'model',
      },
      result.aiCallId,
    );
  } catch (err) {
    if (err instanceof AIError && err.kind === 'aborted') throw err;
    // Degrade gracefully: short messages are treated as follow-ups on the previous topic.
    const followUp = wordCount(message) <= 8 && topic;
    return done({
      intent: followUp ? 'follow_up' : 'question',
      standaloneQuery: followUp ? `${topic} ${message}` : message,
      needsMaterials: true,
      method: 'fallback',
    });
  }
}
