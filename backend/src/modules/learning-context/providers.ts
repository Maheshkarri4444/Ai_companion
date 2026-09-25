import type { CallMeta } from '../../ai';
import { logger } from '../../lib/logger';
import { escapePromptData, truncate } from '../../lib/text';
import { toObjectId } from '../../lib/validation';
import { ActivityEvent, type ActivityType } from '../../models/activityEvent.model';
import { Concept } from '../../models/knowledge.model';
import { Material } from '../../models/material.model';
import { Project } from '../../models/project.model';
import { recallLearning } from './learning-context.service';

/*
 * Context composition (PRD §11 "Identify Required Context → Compose AI Context", docs/ARCHITECTURE.md §15).
 * Each provider contributes one small block; the composer keeps them within a character budget, highest
 * priority first. Later phases register providers (mastery, assessment history, recommendations) and every
 * AI experience that composes context — the Tutor included — picks them up without code changes.
 */

export type ContextPurpose = 'tutor' | 'quiz' | 'recommendation' | 'insight';

export interface ContextRequest {
  ownerId: string;
  projectId: string;
  /** What the AI is about to do — providers use it to select only relevant context. */
  query: string;
  purpose: ContextPurpose;
  intent?: string;
  meta?: CallMeta;
  signal?: AbortSignal;
}

export interface ContextBlock {
  id: string;
  title: string;
  lines: string[];
  /** Structured form for tools (e.g. the Tutor's get_learning_state). */
  data?: Record<string, unknown>;
}

export interface ContextProvider {
  id: string;
  /** Higher first; lower-priority blocks are dropped when the budget runs out. */
  priority: number;
  purposes?: ContextPurpose[];
  load(request: ContextRequest): Promise<ContextBlock | null>;
}

const providers = new Map<string, ContextProvider>();

export function registerContextProvider(provider: ContextProvider) {
  providers.set(provider.id, provider);
}

export function registeredContextProviders() {
  return [...providers.values()].map((p) => ({ id: p.id, priority: p.priority, purposes: p.purposes ?? 'all' }));
}

const PROVIDER_TIMEOUT_MS = 2500;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface ComposedContext {
  blocks: ContextBlock[];
  text: string;
  trace: Array<{ id: string; status: 'ok' | 'empty' | 'error' | 'dropped'; chars: number; ms: number; error?: string }>;
}

/** Runs providers in parallel (each best-effort with a timeout) and renders the budgeted context text. */
export async function composeContext(request: ContextRequest, options: { budgetChars?: number; only?: string[] } = {}): Promise<ComposedContext> {
  const budget = options.budgetChars ?? 3500;
  const selected = [...providers.values()]
    .filter((p) => (!p.purposes || p.purposes.includes(request.purpose)) && (!options.only || options.only.includes(p.id)))
    .sort((a, b) => b.priority - a.priority);

  const results = await Promise.all(
    selected.map(async (provider) => {
      const started = Date.now();
      try {
        const block = await withTimeout(provider.load(request), PROVIDER_TIMEOUT_MS);
        return { provider, block, ms: Date.now() - started, error: null as string | null };
      } catch (err) {
        logger.warn({ provider: provider.id, err: (err as Error).message }, 'Context provider failed');
        return { provider, block: null, ms: Date.now() - started, error: (err as Error).message };
      }
    }),
  );

  const blocks: ContextBlock[] = [];
  const trace: ComposedContext['trace'] = [];
  const parts: string[] = [];
  let used = 0;
  for (const { provider, block, ms, error } of results) {
    if (error) {
      trace.push({ id: provider.id, status: 'error', chars: 0, ms, error: truncate(error, 120) });
      continue;
    }
    if (!block || block.lines.length === 0) {
      trace.push({ id: provider.id, status: 'empty', chars: 0, ms });
      continue;
    }
    const rendered = `## ${block.title}\n${block.lines.map((l) => `- ${escapePromptData(l)}`).join('\n')}`;
    if (used + rendered.length > budget) {
      trace.push({ id: provider.id, status: 'dropped', chars: rendered.length, ms });
      continue;
    }
    used += rendered.length;
    parts.push(rendered);
    blocks.push(block);
    trace.push({ id: provider.id, status: 'ok', chars: rendered.length, ms });
  }
  return { blocks, text: parts.join('\n\n'), trace };
}

export function ago(date: Date | string): string {
  const minutes = Math.round((Date.now() - new Date(date).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/* ─────────────────────────── Built-in providers ─────────────────────────── */

const projectProfile: ContextProvider = {
  id: 'project_profile',
  priority: 100,
  async load({ ownerId, projectId }) {
    const owner = toObjectId(ownerId);
    const project = await Project.findOne({ _id: toObjectId(projectId), ownerId: owner }).lean();
    if (!project) return null;
    const [materials, concepts] = await Promise.all([
      Material.find({ ownerId: owner, projectId: project._id }, { title: 1, status: 1, pageCount: 1 }).sort({ createdAt: 1 }).limit(20).lean(),
      Concept.find({ ownerId: owner, projectId: project._id }, { name: 1, importance: 1 }).sort({ importance: -1, chunkCount: -1 }).limit(12).lean(),
    ]);
    const ready = materials.filter((m) => m.status === 'ready');
    const pending = materials.filter((m) => m.status === 'queued' || m.status === 'processing').length;
    const lines = [
      `Project: ${project.name}${project.description ? ` — ${truncate(project.description, 200)}` : ''}`,
      `Learning goal: ${truncate(project.learningGoal, 300)}`,
      ready.length
        ? `Materials ready: ${ready.map((m) => `${m.title}${m.pageCount ? ` (${m.pageCount} pages)` : ''}`).join('; ')}`
        : 'Materials ready: none yet',
    ];
    if (pending) lines.push(`Materials still processing: ${pending}`);
    if (concepts.length) lines.push(`Key concepts: ${concepts.map((c) => c.name).join(', ')}`);
    return {
      id: 'project_profile',
      title: 'Project',
      lines,
      data: {
        name: project.name,
        goal: project.learningGoal,
        materials: materials.map((m) => ({ title: m.title, status: m.status, pages: m.pageCount })),
        keyConcepts: concepts.map((c) => c.name),
      },
    };
  },
};

const learnerMemory: ContextProvider = {
  id: 'learner_memory',
  priority: 90,
  async load({ ownerId, projectId, query, meta, signal }) {
    const items = await recallLearning({ ownerId, projectId, query, limit: 6, meta, signal });
    if (items.length === 0) return null;
    return {
      id: 'learner_memory',
      title: 'What you know about this learner',
      lines: items.map((i) => `(${i.kind.replace('_', ' ')}${i.evidenceCount > 1 ? `, observed ${i.evidenceCount}×` : ''}) ${i.content}`),
      data: { items: items.map((i) => ({ kind: i.kind, content: i.content, evidenceCount: i.evidenceCount })) },
    };
  },
};

const ACTIVITY_LABELS: Partial<Record<ActivityType, (m: Record<string, unknown>) => string>> = {
  'material.uploaded': (m) => `Uploaded "${m.materialTitle}"`,
  'material.processed': (m) => `Material "${m.materialTitle}" became ready (${m.conceptCount ?? 0} concepts)`,
  'material.failed': (m) => `Processing of "${m.materialTitle}" failed`,
  'project.updated': () => 'Updated the Project details',
};

const recentActivity: ContextProvider = {
  id: 'recent_activity',
  priority: 40,
  async load({ ownerId, projectId }) {
    const types = Object.keys(ACTIVITY_LABELS) as ActivityType[];
    const events = await ActivityEvent.find({ ownerId: toObjectId(ownerId), projectId: toObjectId(projectId), type: { $in: types } })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    if (events.length === 0) return null;
    return {
      id: 'recent_activity',
      title: 'Recent learning activity',
      lines: events.map((e) => `${ago(e.createdAt)}: ${ACTIVITY_LABELS[e.type]?.(e.metadata ?? {}) ?? e.type}`),
    };
  },
};

/** Registers the providers that exist today; later phases add theirs next to their own module. */
export function registerCoreContextProviders() {
  registerContextProvider(projectProfile);
  registerContextProvider(learnerMemory);
  registerContextProvider(recentActivity);
}
