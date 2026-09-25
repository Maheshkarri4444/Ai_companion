/**
 * Offline regression suite for Zoya:  npm run eval:tutor -- [--judge] [--record] [--baseline] [--write-baseline]
 *                                                             [--only=id,id] [--label=text]
 *
 * Runs in an isolated in-memory MongoDB with the configured (real) AI provider:
 *   1. processes the dataset materials through the real pipeline (extract → chunk → embed → concepts),
 *   2. measures retrieval (hit@1, hit@3, MRR),
 *   3. runs every Tutor case and checks grounding, citations, unsupported-question handling, injection
 *      resistance and pedagogy expectations (+ the online rule checks, + optional LLM judge),
 *   4. writes a JSON report, optionally compares against the committed baseline (exit 1 on regression)
 *      and records the run so it appears in Admin → AI evaluation.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { ai } from '../../src/ai';
import { EVALUATION_PROMPTS } from '../../src/ai/prompts/evaluation';
import { TUTOR_PROMPTS } from '../../src/ai/prompts/tutor';
import { registerModules } from '../../src/bootstrap';
import { config } from '../../src/config/env';
import { drainJobs } from '../../src/jobs/worker';
import { AiCall } from '../../src/models/aiCall.model';
import { AiEvaluation, EvalRun } from '../../src/models/aiEvaluation.model';
import { Concept } from '../../src/models/knowledge.model';
import { Material } from '../../src/models/material.model';
import { Message } from '../../src/models/message.model';
import { Project } from '../../src/models/project.model';
import { Space } from '../../src/models/space.model';
import { User } from '../../src/models/user.model';
import { tutorRuleChecks, verdictOf } from '../../src/modules/evaluation/tutor-rules';
import { judgeTutorMessage } from '../../src/modules/evaluation/tutor-judge';
import { enqueueMaterialProcessing } from '../../src/modules/knowledge/knowledge.service';
import { retrieve } from '../../src/modules/knowledge/retrieval';
import { ensureVectorIndex } from '../../src/modules/knowledge/vector-index';
import { runTutorTurn } from '../../src/modules/tutor/orchestrator';
import { storage } from '../../src/storage/storage';
import { CASES, MATERIALS, PROJECT, RETRIEVAL_CASES, type PageRef, type TutorCase } from './dataset';

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(here, '..', 'output');
const BASELINE = join(here, 'baseline.json');

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'] as const;
  }),
);
const only = args.get('only')?.split(',');

/** Standard PDF fonts only encode WinAnsi: map the few symbols the dataset uses to ASCII equivalents. */
const toWinAnsi = (text: string) =>
  text
    .replace(/←/g, '<-')
    .replace(/·/g, '*')
    .replace(/∂/g, 'd')
    .replace(/η/g, 'eta')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\n]/g, ' ');

async function makeTextPdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    let y = 750;
    for (const paragraph of toWinAnsi(text).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, 10.5) > 510) {
          page.drawText(line, { x: 50, y, size: 10.5, font });
          y -= 15;
          line = word;
        } else line = next;
      }
      if (line) page.drawText(line, { x: 50, y, size: 10.5, font });
      y -= 22;
    }
  }
  return Buffer.from(await doc.save());
}

const matches = (ref: PageRef, s: { materialTitle: string; pageStart: number; pageEnd: number }) =>
  ref.material === s.materialTitle && ref.page >= s.pageStart && ref.page <= s.pageEnd;

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

async function main() {
  if (config.AI_PROVIDER === 'gemini' && !config.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set — the regression suite evaluates the real models.');
    process.exit(2);
  }
  const started = Date.now();
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'tutor_eval' });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  registerModules();
  await ensureVectorIndex(); // unavailable in-memory → in-process similarity (same scoring scale as Atlas)

  console.log(`\nZoya regression suite · provider=${ai().provider.name} · primary=${config.AI_MODEL_PRIMARY} · light=${config.AI_MODEL_LIGHT} · embedding=${config.AI_EMBEDDING_MODEL}`);
  console.log(`Thresholds: strong ≥ ${config.RETRIEVAL_STRONG_SCORE}, min ≥ ${config.RETRIEVAL_MIN_SCORE}\n`);

  // ── 1. Knowledge: the real processing pipeline ──
  const user = await User.create({ name: 'Eval Learner', email: `eval-${randomUUID().slice(0, 6)}@example.com`, passwordHash: 'not-a-login', role: 'user' });
  const space = await Space.create({ ownerId: user._id, name: 'Machine Learning', description: 'Regression suite' });
  const project = await Project.create({ ownerId: user._id, spaceId: space._id, ...PROJECT });
  const ownerId = user._id.toString();
  const projectId = project._id.toString();

  const t0 = Date.now();
  for (const m of MATERIALS) {
    const buffer = await makeTextPdf(m.pages);
    const materialId = new mongoose.Types.ObjectId();
    const stored = await storage.save({ buffer, filename: `${m.title}.pdf`, metadata: { ownerId: user._id, projectId: project._id, materialId } });
    const material = await Material.create({
      _id: materialId,
      ownerId: user._id,
      spaceId: space._id,
      projectId: project._id,
      title: m.title,
      originalFilename: `${m.title}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: buffer.length,
      sha256: randomUUID(),
      storage: { provider: 'gridfs', fileId: new mongoose.Types.ObjectId(stored.fileId) },
      status: 'queued',
    });
    await enqueueMaterialProcessing(material.toObject());
  }
  const processing = await drainJobs({ types: ['material.process'] });
  const materials = await Material.find({ projectId: project._id }).lean();
  const conceptCount = await Concept.countDocuments({ projectId: project._id });
  console.log(`Knowledge: ${materials.map((m) => `${m.title} → ${m.status} (${m.pageCount ?? '?'} pages, ${m.stats.chunkCount} chunks)`).join(' · ')} · ${conceptCount} concepts · ${Math.round((Date.now() - t0) / 1000)} s`);
  if (processing.failed || materials.some((m) => m.status !== 'ready')) {
    console.error('Material processing failed:', materials.map((m) => m.processing.error));
    process.exit(1);
  }

  // ── 2. Retrieval ──
  const retrievalResults: Array<{ id: string; query: string; rank: number; topScore: number; sufficiency: string }> = [];
  for (const rc of RETRIEVAL_CASES) {
    const r = await retrieve({ ownerId, projectId, query: rc.query, limit: 6 });
    const rank = r.sources.findIndex((s) => rc.expectAny.some((ref) => matches(ref, s))) + 1;
    retrievalResults.push({ id: rc.id, query: rc.query, rank, topScore: r.topScore, sufficiency: r.sufficiency });
  }
  const hitAt = (k: number) => retrievalResults.filter((r) => r.rank > 0 && r.rank <= k).length / retrievalResults.length;
  const mrr = retrievalResults.reduce((n, r) => n + (r.rank ? 1 / r.rank : 0), 0) / retrievalResults.length;
  console.log(`Retrieval: hit@1 ${pct(hitAt(1))} · hit@3 ${pct(hitAt(3))} · MRR ${mrr.toFixed(3)}`);
  for (const r of retrievalResults.filter((x) => x.rank !== 1)) console.log(`  · ${r.id}: rank ${r.rank || 'miss'} (top ${r.topScore}, ${r.sufficiency})`);

  // ── 3. Tutor cases ──
  const results: CaseResult[] = [];
  const cases = CASES.filter((c) => !only || only.includes(c.id));
  for (const c of cases) {
    const result = await runCase(c, ownerId, projectId);
    results.push(result);
    const failedChecks = result.checks.filter((k) => !k.passed);
    console.log(
      `${result.passed ? '✔' : '✘'} ${c.id.padEnd(38)} ${String(result.grounding).padEnd(14)} top=${String(result.retrieval.topScore ?? '-').padEnd(5)} ${String(result.latencyMs).padStart(6)} ms  ${result.citedPages.join(', ')}${failedChecks.length ? `  ← ${failedChecks.map((k) => `${k.name}${k.detail ? ` (${k.detail})` : ''}`).join('; ')}` : ''}`,
    );
  }

  // ── 4. Summary ──
  const passed = results.filter((r) => r.passed).length;
  const rate = (filter: (r: (typeof results)[number]) => boolean) => {
    const subset = results.filter(filter);
    return subset.length ? subset.filter((r) => r.passed).length / subset.length : 1;
  };
  const withCitations = results.filter((r) => r.checks.some((k) => k.name === 'cites_expected_page'));
  const latencies = results.map((r) => r.latencyMs);
  const judged = results.filter((r) => r.judge);
  const costUsd = (await AiCall.aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: '$costUsd' } } }]))[0]?.total ?? 0;
  const metrics: Record<string, number> = {
    passRate: passed / Math.max(results.length, 1),
    groundedAccuracy: rate((r) => ['grounded', 'cross_material', 'follow_up'].includes(r.category)),
    citationCorrectness: withCitations.length ? withCitations.filter((r) => r.checks.find((k) => k.name === 'cites_expected_page')!.passed).length / withCitations.length : 1,
    unsupportedHandling: rate((r) => r.category === 'unsupported' || r.category === 'partial'),
    injectionResistance: rate((r) => r.category === 'security'),
    retrievalHitAt1: hitAt(1),
    retrievalHitAt3: hitAt(3),
    retrievalMrr: mrr,
    avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / Math.max(latencies.length, 1)),
    p95LatencyMs: percentile(latencies, 95),
    totalCostUsd: Math.round(costUsd * 1e6) / 1e6,
    ...(judged.length
      ? {
          judgeGroundedness: judged.reduce((n, r) => n + (r.judge!.groundedness ?? 0), 0) / judged.length,
          judgeCitationAccuracy: judged.reduce((n, r) => n + (r.judge!.citationAccuracy ?? 0), 0) / judged.length,
        }
      : {}),
  };
  console.log(
    `\nPassed ${passed}/${results.length} (${pct(metrics.passRate)}) · grounded ${pct(metrics.groundedAccuracy)} · citations ${pct(metrics.citationCorrectness)} · unsupported ${pct(metrics.unsupportedHandling)} · injection ${pct(metrics.injectionResistance)} · avg ${metrics.avgLatencyMs} ms · p95 ${metrics.p95LatencyMs} ms · cost $${metrics.totalCostUsd}`,
  );

  const report = {
    suite: 'tutor-core',
    label: args.get('label') ?? null,
    provider: ai().provider.name,
    models: { primary: config.AI_MODEL_PRIMARY, light: config.AI_MODEL_LIGHT, embedding: config.AI_EMBEDDING_MODEL },
    promptVersions: { ...TUTOR_PROMPTS, ...EVALUATION_PROMPTS },
    config: { strongScore: config.RETRIEVAL_STRONG_SCORE, minScore: config.RETRIEVAL_MIN_SCORE, reasoning: config.AI_TUTOR_REASONING },
    summary: { cases: results.length, passed, failed: results.length - passed, passRate: metrics.passRate, metrics },
    retrieval: retrievalResults,
    cases: results,
    durationMs: Date.now() - started,
    createdAt: new Date(),
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = join(OUTPUT_DIR, `tutor-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  writeFileSync(join(OUTPUT_DIR, 'latest.json'), JSON.stringify(report, null, 2));
  console.log(`Report: ${file}`);

  let exitCode = 0;
  if (args.has('baseline') && existsSync(BASELINE)) {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as { summary: { metrics: Record<string, number> } };
    const regressions = (['passRate', 'groundedAccuracy', 'unsupportedHandling', 'injectionResistance', 'retrievalHitAt3'] as const)
      .map((key) => ({ key, before: baseline.summary.metrics[key] ?? 0, after: metrics[key] }))
      .filter((m) => m.after < m.before - 0.05);
    if (regressions.length) {
      console.error(`\nRegression vs baseline: ${regressions.map((r) => `${r.key} ${pct(r.before)} → ${pct(r.after)}`).join(', ')}`);
      exitCode = 1;
    } else console.log('\nNo regression vs baseline.');
  }
  if (args.has('write-baseline')) {
    writeFileSync(BASELINE, JSON.stringify({ ...report, cases: report.cases.map(({ answerPreview: _a, ...rest }) => rest) }, null, 2));
    console.log(`Baseline updated: ${BASELINE}`);
  }

  await mongoose.disconnect();
  await mongod.stop();

  if (args.has('record')) {
    try {
      await mongoose.connect(config.MONGODB_URI, { dbName: config.MONGODB_DB_NAME, serverSelectionTimeoutMS: 10_000 });
      await EvalRun.create({ ...report, cases: report.cases.map((c) => ({ ...c, judge: undefined })) });
      console.log('Recorded in eval_runs (visible in Admin → AI evaluation).');
      await mongoose.disconnect();
    } catch (err) {
      console.warn(`Could not record the run: ${(err as Error).message}`);
    }
  }
  process.exit(exitCode);
}

type CaseResult = Awaited<ReturnType<typeof runCase>>;

async function runCase(c: TutorCase, ownerId: string, projectId: string) {
  let conversationId: string | undefined;
  for (const content of c.history ?? []) {
    const earlier = await runTutorTurn({ ownerId, projectId, conversationId, clientMessageId: randomUUID(), content, mode: 'auto', action: null });
    conversationId = earlier.conversationId;
  }
  const message = await runTutorTurn({
    ownerId,
    projectId,
    conversationId,
    clientMessageId: randomUUID(),
    content: c.question,
    mode: c.mode ?? 'auto',
    action: c.action ?? null,
  });
  const stored = (await Message.findById(message.id).lean())!;
  const content = message.content;
  const lower = content.toLowerCase();
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];
  const e = c.expect;

  checks.push({ name: 'completed', passed: message.status === 'complete', detail: message.error?.code });
  if (e.grounding) checks.push({ name: 'grounding', passed: e.grounding.includes(message.grounding!.status as never), detail: String(message.grounding?.status) });
  if (e.citeAny) {
    checks.push({
      name: 'cites_expected_page',
      passed: message.citations.some((s) => e.citeAny!.some((ref) => matches(ref, s))),
      detail: `expected ${e.citeAny.map((r) => `${r.material} p${r.page}`).join(' or ')}`,
    });
  }
  if (e.noCitations) checks.push({ name: 'no_citations', passed: message.citations.length === 0 });
  if (e.mentionPattern) {
    checks.push({ name: 'matches_pattern', passed: new RegExp(e.mentionPattern, 'i').test(content), detail: e.mentionPattern.slice(0, 40) });
  }
  if (e.mentionAny) {
    checks.push({ name: 'mentions_expected', passed: e.mentionAny.some((p) => lower.includes(p.toLowerCase())), detail: e.mentionAny.slice(0, 3).join(' | ') });
  }
  for (const phrase of e.mentionNone ?? []) {
    checks.push({ name: `avoids "${phrase}"`, passed: !lower.includes(phrase.toLowerCase()) });
  }
  if (e.minQuestions) {
    const questions = (content.match(/\?/g) ?? []).length;
    checks.push({ name: 'asks_questions', passed: questions >= e.minQuestions, detail: `${questions} question marks` });
  }
  const ruleChecks = tutorRuleChecks(stored);
  const ruleVerdict = verdictOf(ruleChecks);
  checks.push({
    name: 'online_rules',
    passed: ruleVerdict !== 'fail',
    detail: ruleChecks.filter((r) => !r.passed).map((r) => r.name).join(', ') || undefined,
  });

  let judge: Record<string, number> | null = null;
  if (args.has('judge') && message.status === 'complete' && message.grounding?.status !== 'conversational') {
    await judgeTutorMessage(message.id, { jobId: new mongoose.Types.ObjectId().toString(), signal: new AbortController().signal }).catch((err) =>
      console.warn(`  judge failed for ${c.id}: ${(err as Error).message}`),
    );
    const evaluation = await AiEvaluation.findOne({ subjectId: stored._id, evaluator: 'llm_judge' }).lean();
    judge = evaluation ? { ...evaluation.scores } : null;
  }

  return {
    id: c.id,
    category: c.category,
    question: c.question,
    passed: checks.every((k) => k.passed),
    checks,
    grounding: message.grounding?.status ?? null,
    retrieval: { sufficiency: stored.grounding?.sufficiency ?? null, topScore: stored.grounding?.topScore ?? null, route: stored.trace?.route ?? null },
    answerPreview: content.slice(0, 600),
    citedPages: message.citations.map((s) => `${s.materialTitle} p${s.pageStart}${s.pageEnd !== s.pageStart ? `-${s.pageEnd}` : ''}`),
    latencyMs: stored.metrics.latencyMs ?? 0,
    ttftMs: stored.metrics.ttftMs ?? null,
    costUsd: stored.metrics.costUsd,
    judge,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
