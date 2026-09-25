import { z } from 'zod';
import { toObjectId } from '../../lib/validation';
import { Concept } from '../../models/knowledge.model';
import { conceptMastery, masterySummary } from '../mastery/mastery.service';
import { registerTutorTool, type TutorTool } from '../tutor/tools';

/*
 * Assessment capabilities exposed to Zoya through the controlled tool interface (PRD §8, docs/ARCHITECTURE.md §15):
 * reading mastery, and offering a quiz. The model can only *propose* a quiz — the link is built server-side from
 * validated concepts of the current Project, and the learner decides whether to start it.
 */

const pct = (x: number) => `${Math.round(x * 100)}%`;

const getMastery: TutorTool<Record<string, never>> = {
  name: 'get_mastery',
  label: 'Checking your concept mastery',
  description:
    "Get the learner's estimated mastery of each concept in this Project, measured by quiz answers: percentage, confidence, number of answers, the question level they find hardest, and concepts not yet assessed. Use it to adapt an explanation or to suggest what to practise.",
  args: z.object({}),
  maxCallsPerTurn: 1,
  async execute(_args, ctx) {
    const concepts = await conceptMastery(toObjectId(ctx.ownerId), toObjectId(ctx.projectId));
    const summary = masterySummary(concepts);
    return {
      result: {
        overallMastery: summary.overallMastery === null ? 'not assessed yet' : pct(summary.overallMastery),
        assessedConcepts: summary.assessedConcepts,
        totalConcepts: summary.totalConcepts,
        concepts: concepts.slice(0, 30).map((c) => ({
          name: c.name,
          mastery: c.mastery === null ? 'not assessed' : pct(c.mastery),
          confidence: c.confidence,
          answers: c.evidenceCount,
          hardestLevel: c.weakestLevel,
        })),
      },
      summary: `Checked mastery of ${concepts.length} concept${concepts.length === 1 ? '' : 's'}`,
    };
  },
};

function matchConcept<T extends { name: string }>(concepts: T[], wanted: string): T | undefined {
  const w = wanted.trim().toLowerCase();
  return (
    concepts.find((c) => c.name.toLowerCase() === w) ??
    concepts.find((c) => c.name.toLowerCase().startsWith(w)) ??
    concepts.find((c) => c.name.toLowerCase().includes(w) || w.includes(c.name.toLowerCase()))
  );
}

const proposeQuiz: TutorTool<{ concepts?: string[]; questionCount?: number }> = {
  name: 'propose_quiz',
  label: 'Preparing a practice quiz',
  description:
    'Offer the learner an adaptive practice quiz from their materials — optionally focused on specific concepts of this Project — when they ask to be tested or would clearly benefit from practice. A "Start quiz" button appears under your answer; the learner decides whether to start it. Mention the offer in one short sentence.',
  args: z.object({
    concepts: z.array(z.string().trim().min(2).max(120)).max(5).optional().describe('Concept names from this Project to focus on; omit for an adaptive quiz across all concepts'),
    questionCount: z.number().int().min(3).max(10).optional().describe('Number of questions (default 5)'),
  }),
  maxCallsPerTurn: 1,
  async execute(args, ctx) {
    const concepts = await Concept.find({ ownerId: toObjectId(ctx.ownerId), projectId: toObjectId(ctx.projectId) }, { name: 1, chunkCount: 1, sources: 1 }).lean();
    const assessable = concepts.filter((c) => (c.chunkCount ?? 0) > 0 || c.sources.some((s) => s.pages.length > 0));
    if (assessable.length === 0) {
      return { result: { offered: false, error: 'This Project has no processed material to build a quiz from yet.' }, summary: 'No quiz material yet' };
    }
    const requested = args.concepts ?? [];
    const matched = [...new Map(requested.map((name) => matchConcept(assessable, name)).filter((c) => c !== undefined).map((c) => [c._id.toString(), c])).values()];
    const count = args.questionCount ?? 5;
    const params = new URLSearchParams({ count: String(count) });
    if (matched.length) params.set('focus', matched.map((c) => c._id.toString()).join(','));
    const names = matched.map((c) => c.name);
    const label = names.length ? `Start a ${count}-question quiz on ${names.join(', ')}` : `Start a ${count}-question adaptive quiz`;
    return {
      result: {
        offered: true,
        focus: names,
        unknownConcepts: requested.filter((r) => !matchConcept(assessable, r)),
        questionCount: count,
        note: 'A "Start quiz" button is shown to the learner under your answer.',
      },
      summary: label,
      data: { kind: 'quiz_link', href: `/projects/${ctx.projectId}/quiz?${params.toString()}`, label },
    };
  },
};

export function registerQuizTutorTools() {
  registerTutorTool(getMastery);
  registerTutorTool(proposeQuiz);
}
