import { Schema, model, type Types } from 'mongoose';

/*
 * Adaptive quiz & assessment (PRD §9, docs/ARCHITECTURE.md §16). A session serves generated questions one at a
 * time; every answer becomes an attempt, and graded attempts update concept mastery (models/mastery.model.ts).
 */

export const QUIZ_MODES = ['adaptive', 'focused', 'review'] as const;
export type QuizMode = (typeof QUIZ_MODES)[number];

export const QUIZ_STATUSES = ['active', 'completed', 'abandoned'] as const;
export type QuizStatus = (typeof QUIZ_STATUSES)[number];

export const QUESTION_TYPES = ['mcq', 'open'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** What the learner asked for; the engine picks the type of each question within it. */
export const QUESTION_TYPE_PREFERENCES = ['mixed', 'mcq', 'open'] as const;
export type QuestionTypePreference = (typeof QUESTION_TYPE_PREFERENCES)[number];

export const COGNITIVE_LEVELS = ['recall', 'understand', 'apply', 'analyze'] as const;
export type CognitiveLevel = (typeof COGNITIVE_LEVELS)[number];

export const OPTION_IDS = ['A', 'B', 'C', 'D'] as const;

/* ─────────────────────────────── Sessions ─────────────────────────────── */

export interface ConceptResult {
  conceptId: Types.ObjectId;
  name: string;
  answered: number;
  avgScore: number | null;
  masteryBefore: number | null;
  masteryAfter: number | null;
}

export interface ReviewSuggestion {
  materialId: Types.ObjectId;
  materialTitle: string;
  pages: number[];
  conceptName: string;
}

/** Stored when the session ends; computed on the fly while it is active. */
export interface QuizSummary {
  answered: number;
  graded: number;
  pending: number;
  correct: number;
  accuracy: number | null;
  avgScore: number | null;
  timeMs: number;
  byConcept: ConceptResult[];
  byLevel: Record<CognitiveLevel, { n: number; avgScore: number | null }>;
  byType: Record<QuestionType, { n: number; avgScore: number | null }>;
  strengths: string[];
  needsWork: string[];
  review: ReviewSuggestion[];
}

export interface IQuizSession {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  spaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  status: QuizStatus;
  mode: QuizMode;
  questionTypes: QuestionTypePreference;
  focusConceptIds: Types.ObjectId[];
  targetCount: number;
  servedCount: number;
  /** Submitted answers (graded or still being graded). */
  answeredCount: number;
  gradedCount: number;
  correctCount: number;
  scoreSum: number;
  /** The served, not yet answered question — the single source of truth for "what is on screen". */
  currentQuestionId: Types.ObjectId | null;
  /** One generation at a time per session (background pre-generation vs. an impatient "next"). */
  generation: {
    lockedUntil: Date | null;
    token: string | null;
    failures: number;
    lastError: { code: string; message: string } | null;
  };
  summary: QuizSummary | null;
  startedAt: Date;
  completedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const quizSessionSchema = new Schema<IQuizSession>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    status: { type: String, enum: QUIZ_STATUSES, default: 'active' },
    mode: { type: String, enum: QUIZ_MODES, default: 'adaptive' },
    questionTypes: { type: String, enum: QUESTION_TYPE_PREFERENCES, default: 'mixed' },
    focusConceptIds: { type: [Schema.Types.ObjectId], default: [] },
    targetCount: { type: Number, required: true, min: 1, max: 30 },
    servedCount: { type: Number, default: 0 },
    answeredCount: { type: Number, default: 0 },
    gradedCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    scoreSum: { type: Number, default: 0 },
    currentQuestionId: { type: Schema.Types.ObjectId, default: null },
    generation: {
      lockedUntil: { type: Date, default: null },
      token: { type: String, default: null },
      failures: { type: Number, default: 0 },
      lastError: { type: new Schema({ code: String, message: String }, { _id: false }), default: null },
    },
    summary: { type: Schema.Types.Mixed, default: null },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, minimize: false },
);

quizSessionSchema.index({ ownerId: 1, projectId: 1, createdAt: -1 });
quizSessionSchema.index({ projectId: 1, status: 1 });
quizSessionSchema.index({ status: 1, completedAt: -1 }); // reconciler: recently completed sessions
// At most one active session per learner and Project: a second start closes the first (and loses this race).
quizSessionSchema.index(
  { ownerId: 1, projectId: 1 },
  { unique: true, name: 'one_active_session', partialFilterExpression: { status: { $eq: 'active' } } },
);

export const QuizSession = model<IQuizSession>('QuizSession', quizSessionSchema, 'quiz_sessions');

/* ─────────────────────────────── Questions ─────────────────────────────── */

export interface IQuestionOption {
  id: string;
  text: string;
  /** Why this option is right or wrong — becomes feedback when the learner picks it. */
  rationale: string;
}

/** The evidence a question was written from ("Source: Title — Page N" after answering). */
export interface IQuestionSource {
  ref: string;
  chunkId: Types.ObjectId | null;
  materialId: Types.ObjectId;
  materialTitle: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  snippet: string;
  /** Named by the generator as supporting the answer. */
  cited: boolean;
}

export interface IQuestionSelection {
  priority: number;
  probability: number;
  predictedP: number;
  targetP: number;
  mastery: number | null;
  evidence: number;
  explored: boolean;
  reason: string;
  components: Record<string, number>;
}

export interface IQuestion {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  sessionId: Types.ObjectId;
  /** ready = pre-generated, not yet shown · served · answered · discarded (session ended first). */
  status: 'ready' | 'served' | 'answered' | 'discarded';
  position: number | null;
  conceptIds: Types.ObjectId[];
  /** Name snapshots so history stays readable if a concept is renamed or removed. */
  conceptNames: string[];
  type: QuestionType;
  difficulty: number;
  cognitiveLevel: CognitiveLevel;
  stem: string;
  options: IQuestionOption[];
  correctOptionId: string | null;
  explanation: string;
  rubric: { keyPoints: string[]; sampleAnswer: string } | null;
  sources: IQuestionSource[];
  selection: IQuestionSelection;
  /** Normalised stem hash: a learner never sees the same question twice in a Project. */
  stemHash: string;
  generation: {
    aiCallId: Types.ObjectId | null;
    promptVersion: string | null;
    model: string | null;
    attempts: number;
    latencyMs: number;
    costUsd: number;
    validation: { passed: boolean; issues: string[]; warnings: string[] };
    selfRated: { difficulty: number | null; cognitiveLevel: string | null };
  };
  servedAt: Date | null;
  answeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const questionSchema = new Schema<IQuestion>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'QuizSession', required: true },
    status: { type: String, enum: ['ready', 'served', 'answered', 'discarded'], default: 'ready' },
    position: { type: Number, default: null },
    conceptIds: { type: [Schema.Types.ObjectId], default: [] },
    conceptNames: { type: [String], default: [] },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    difficulty: { type: Number, required: true, min: 1, max: 5 },
    cognitiveLevel: { type: String, enum: COGNITIVE_LEVELS, required: true },
    stem: { type: String, required: true, maxlength: 1200 },
    options: {
      type: [new Schema({ id: String, text: String, rationale: String }, { _id: false })],
      default: [],
    },
    correctOptionId: { type: String, default: null },
    explanation: { type: String, default: '' },
    rubric: {
      type: new Schema({ keyPoints: [String], sampleAnswer: String }, { _id: false }),
      default: null,
    },
    sources: {
      type: [
        new Schema(
          {
            ref: String,
            chunkId: { type: Schema.Types.ObjectId, default: null },
            materialId: Schema.Types.ObjectId,
            materialTitle: String,
            pageStart: Number,
            pageEnd: Number,
            sectionTitle: { type: String, default: null },
            snippet: String,
            cited: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    selection: { type: Schema.Types.Mixed, default: {} },
    stemHash: { type: String, required: true },
    generation: { type: Schema.Types.Mixed, default: {} },
    servedAt: { type: Date, default: null },
    answeredAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

questionSchema.index({ sessionId: 1, status: 1 });
questionSchema.index({ ownerId: 1, projectId: 1, stemHash: 1 });
questionSchema.index({ ownerId: 1, projectId: 1, conceptIds: 1, createdAt: -1 });
questionSchema.index({ projectId: 1, createdAt: -1 });

export const Question = model<IQuestion>('Question', questionSchema, 'questions');

/* ─────────────────────────────── Attempts ─────────────────────────────── */

export const GRADING_STATUSES = ['graded', 'pending', 'failed'] as const;
export type GradingStatus = (typeof GRADING_STATUSES)[number];

export interface IKeyPointResult {
  point: string;
  status: 'covered' | 'partial' | 'missing';
  evidence: string;
}

export interface IAttemptFeedback {
  summary: string;
  understood: string[];
  missing: string[];
  misconceptions: string[];
  keyPoints: IKeyPointResult[];
}

export interface IMasteryDelta {
  conceptId: Types.ObjectId;
  name: string;
  /** Effective mastery before the update (null = not assessed yet). */
  before: number | null;
  after: number;
  thetaBefore: number;
  thetaAfter: number;
}

export interface IAttempt {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  sessionId: Types.ObjectId;
  questionId: Types.ObjectId;
  conceptIds: Types.ObjectId[];
  type: QuestionType;
  difficulty: number;
  cognitiveLevel: CognitiveLevel;
  response: { optionId: string | null; text: string | null; skipped: boolean };
  /** 0–1 (MCQ 0/1, open-ended rubric score); null while grading is pending. */
  outcome: number | null;
  isCorrect: boolean | null;
  feedback: IAttemptFeedback | null;
  grading: {
    status: GradingStatus;
    method: 'exact' | 'ai' | 'rule';
    aiCallId: Types.ObjectId | null;
    promptVersion: string | null;
    model: string | null;
    scores: Record<string, number> | null;
    flags: string[];
    error: { code: string; message: string } | null;
    attempts: number;
    gradedAt: Date | null;
  };
  /** Mastery is applied exactly once per attempt (the mastery document remembers applied attempt ids too). */
  masteryApplied: boolean;
  masteryDelta: IMasteryDelta[];
  timeMs: number | null;
  /** Client-generated: a retried submission replays the stored result instead of answering twice. */
  idempotencyKey: string;
  report: { target: 'question' | 'grading'; reason: string; comment: string | null; at: Date } | null;
  createdAt: Date;
  updatedAt: Date;
}

const attemptSchema = new Schema<IAttempt>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'QuizSession', required: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    conceptIds: { type: [Schema.Types.ObjectId], default: [] },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    difficulty: { type: Number, required: true },
    cognitiveLevel: { type: String, enum: COGNITIVE_LEVELS, required: true },
    response: {
      optionId: { type: String, default: null },
      text: { type: String, default: null, maxlength: 4000 },
      skipped: { type: Boolean, default: false },
    },
    outcome: { type: Number, default: null, min: 0, max: 1 },
    isCorrect: { type: Boolean, default: null },
    feedback: { type: Schema.Types.Mixed, default: null },
    grading: {
      status: { type: String, enum: GRADING_STATUSES, default: 'pending' },
      method: { type: String, enum: ['exact', 'ai', 'rule'], default: 'exact' },
      aiCallId: { type: Schema.Types.ObjectId, default: null },
      promptVersion: { type: String, default: null },
      model: { type: String, default: null },
      scores: { type: Schema.Types.Mixed, default: null },
      flags: { type: [String], default: [] },
      error: { type: new Schema({ code: String, message: String }, { _id: false }), default: null },
      attempts: { type: Number, default: 0 },
      gradedAt: { type: Date, default: null },
    },
    masteryApplied: { type: Boolean, default: false },
    masteryDelta: { type: Schema.Types.Mixed, default: [] },
    timeMs: { type: Number, default: null },
    idempotencyKey: { type: String, required: true },
    report: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false },
);

// One answer per question; the idempotency key tells a retried request from a second, different answer.
attemptSchema.index({ questionId: 1 }, { unique: true });
attemptSchema.index({ ownerId: 1, idempotencyKey: 1 }, { unique: true });
attemptSchema.index({ sessionId: 1, createdAt: 1 });
attemptSchema.index({ ownerId: 1, projectId: 1, createdAt: -1 });
attemptSchema.index({ ownerId: 1, projectId: 1, conceptIds: 1, createdAt: -1 });
attemptSchema.index({ 'grading.status': 1, updatedAt: 1 });
attemptSchema.index({ masteryApplied: 1, 'grading.status': 1, updatedAt: 1 });

export const Attempt = model<IAttempt>('Attempt', attemptSchema, 'attempts');
