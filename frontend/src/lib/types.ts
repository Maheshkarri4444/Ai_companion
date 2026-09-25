// Mirrors the API's DTOs (backend/src/modules/serializers.ts).

export type Role = "user" | "admin";
export type MaterialStatus = "queued" | "processing" | "ready" | "failed";
export type StatusCounts = Record<MaterialStatus, number>;

export const SPACE_COLOR_KEYS = ["blue", "indigo", "violet", "cyan", "teal", "emerald", "amber", "rose", "slate"] as const;
export type SpaceColor = (typeof SPACE_COLOR_KEYS)[number];

export const SPACE_ICON_KEYS = [
  "book", "brain", "code", "flask", "calculator", "globe", "palette", "music",
  "briefcase", "rocket", "cpu", "languages", "chart", "atom", "scale", "graduation",
] as const;
export type SpaceIcon = (typeof SPACE_ICON_KEYS)[number];

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
}

export interface SpaceSummary {
  id: string;
  name: string;
  color: SpaceColor;
  icon: SpaceIcon;
}

export interface Space extends SpaceSummary {
  description: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  projectCount: number;
  materialCount: number;
}

export interface Project {
  id: string;
  spaceId: string;
  name: string;
  description: string;
  learningGoal: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  materialCount: number;
  materialStatusCounts: StatusCounts;
}

export interface RecentProject extends Project {
  space: SpaceSummary | null;
}

export interface Material {
  id: string;
  projectId: string;
  spaceId: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: MaterialStatus;
  pageCount: number | null;
  processing: {
    stage: string | null;
    progress: number;
    attempts: number;
    startedAt: string | null;
    finishedAt: string | null;
    error: { code: string; message: string; retryable: boolean } | null;
  };
  summary: string | null;
  stats: { chunkCount: number; conceptCount: number; ocrPageCount: number };
  createdAt: string;
  updatedAt: string;
}

export interface Concept {
  id: string;
  name: string;
  description: string;
  importance: number;
  chunkCount: number;
  sources: Array<{ materialId: string; materialTitle: string; pages: number[] }>;
}

export interface MaterialPageText {
  materialId: string;
  materialTitle: string;
  pageNumber: number;
  pageCount: number | null;
  method: "text" | "ocr";
  sectionTitle: string | null;
  text: string;
}

export type ActivityType =
  | "user.registered"
  | "user.logged_in"
  | "space.created"
  | "space.updated"
  | "space.deleted"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "material.uploaded"
  | "material.updated"
  | "material.deleted"
  | "material.processed"
  | "material.failed"
  | "material.reprocessed"
  | "tutor.answered"
  | "tutor.feedback";

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  ownerId: string;
  actorId: string | null;
  spaceId: string | null;
  projectId: string | null;
  materialId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type NextStep =
  | { kind: "create_space" }
  | { kind: "create_project"; spaceId: string; spaceName: string }
  | { kind: "upload_material"; projectId: string; projectName: string }
  | { kind: "await_processing"; projectId: string; projectName: string; pendingCount: number }
  | { kind: "retry_failed"; projectId: string; projectName: string; failedCount: number }
  | { kind: "ask_tutor"; projectId: string; projectName: string; concept: string | null }
  | { kind: "continue_tutor"; projectId: string; projectName: string; conversationId: string; conversationTitle: string }
  | { kind: "continue_project"; projectId: string; projectName: string };

export interface HomeDashboard {
  stats: { spaceCount: number; projectCount: number; materialCount: number; totalBytes: number; materialsByStatus: StatusCounts };
  continueLearning: RecentProject | null;
  recentProjects: RecentProject[];
  recentActivity: ActivityEvent[];
  nextStep: NextStep;
}

export interface SpaceDashboard {
  space: Space;
  projects: Project[];
  stats: { projectCount: number; materialCount: number; totalBytes: number; materialsByStatus: StatusCounts };
  recentActivity: ActivityEvent[];
}

export interface ProjectDashboard {
  project: Project;
  space: SpaceSummary | null;
  stats: { materialCount: number; totalBytes: number; totalPages: number; materialsByStatus: StatusCounts };
  recentMaterials: Material[];
  recentActivity: ActivityEvent[];
  nextStep: NextStep;
}

// ── AI Tutor (Zoya) ───────────────────────────────────────────────────────
export type GroundingStatus = "grounded" | "partial" | "insufficient" | "general" | "conversational";
export type TutorAction = "simplify" | "example" | "check_understanding" | "summarize" | "revision" | "general_knowledge";

export interface TutorSource {
  ref: string;
  kind: "chunk" | "page";
  materialId: string;
  materialTitle: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  snippet: string;
  score: number | null;
  origin: "retrieval" | "tool" | "carried";
  cited: boolean;
  flagged: boolean;
}

export interface TutorCitation {
  ref: string;
  materialId: string;
  materialTitle: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
}

export interface TutorMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "stopped" | "error";
  clientMessageId: string | null;
  replyTo: string | null;
  mode: "auto" | "general";
  action: TutorAction | null;
  intent: string | null;
  grounding: {
    status: GroundingStatus | null;
    sufficiency: "strong" | "weak" | "none" | null;
    topScore: number | null;
    invalidCitations: number;
    degraded: boolean;
  } | null;
  sources: TutorSource[];
  citations: TutorCitation[];
  suggestions: string[];
  toolCalls: Array<{ name: string; ok: boolean; summary: string }>;
  feedback: { rating: "up" | "down"; reason: string | null } | null;
  error: { code: string; message: string } | null;
  metrics: { latencyMs: number | null; ttftMs: number | null; model: string | null } | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  titleSource: "auto" | "ai" | "user";
  messageCount: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  hasSummary: boolean;
  createdAt: string;
}

export interface TutorOverview {
  tutor: { name: string };
  project: { id: string; name: string; learningGoal: string };
  knowledge: { readyMaterials: number; pendingMaterials: number; failedMaterials: number; concepts: string[] };
  starters: string[];
  memoryCount: number;
  stats: { conversations: number; questions: number; groundedAnswers: number };
  conversations: Conversation[];
}

export type LearningKind = "goal" | "preference" | "strength" | "weakness" | "misconception" | "mistake_pattern" | "interest" | "milestone" | "note";

export interface LearningItem {
  id: string;
  kind: LearningKind;
  content: string;
  scope: "project" | "user";
  salience: number;
  evidenceCount: number;
  source: string;
  status: string;
  lastObservedAt: string;
  createdAt: string;
}

export type TutorStreamEvent =
  | { type: "start"; conversation: Conversation; userMessage: TutorMessage; assistantMessageId: string; replay: boolean }
  | { type: "status"; stage: "understanding" | "retrieving" | "thinking" | "searching" | "writing"; label: string }
  | { type: "sources"; sources: TutorSource[] }
  | { type: "tool"; name: string; status: "started" | "finished" | "failed"; summary: string }
  | { type: "delta"; text: string }
  | { type: "reset"; reason: string }
  | { type: "done"; message: TutorMessage; conversation: Conversation }
  | { type: "error"; code: string; message: string };

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

// ── Admin ─────────────────────────────────────────────────────────────────
export interface UserRef {
  id: string;
  name: string;
  email: string;
}

export interface AdminActivityEvent extends ActivityEvent {
  user: UserRef | null;
  actor: UserRef | null;
}

export interface AdminOverview {
  kpis: {
    learners: number;
    admins: number;
    newLearners7d: number;
    activeLearners7d: number;
    spaces: number;
    projects: number;
    materials: number;
    materialsByStatus: StatusCounts;
    storageBytes: number;
    events24h: number;
  };
  activitySeries: Array<{ date: string; events: number; activeUsers: number; signups: number }>;
  topEventTypes: Array<{ type: ActivityType; count: number }>;
  recentUsers: User[];
  recentActivity: AdminActivityEvent[];
}

export interface AdminUserRow extends User {
  counts: { spaces: number; projects: number; materials: number; storageBytes: number };
}

export interface AdminUserDetail {
  user: User;
  stats: {
    spaceCount: number;
    projectCount: number;
    materialCount: number;
    totalBytes: number;
    materialsByStatus: StatusCounts;
    eventCount: number;
    conversationCount: number;
    memoryCount: number;
  };
  aiUsage: {
    calls: number;
    errors: number;
    tokens: number;
    costUsd: number;
    avgLatencyMs: number | null;
    byFeature: Array<{ feature: string; calls: number; costUsd: number }>;
    tutorAnswers: number;
    grounding: Record<string, number>;
    feedback: { up: number; down: number };
  };
  spaces: Array<Space & { projects: Project[] }>;
  materials: Array<Material & { projectName: string | null }>;
  recentActivity: ActivityEvent[];
}

export interface AdminSpaceRow extends Space {
  owner: UserRef | null;
}

export interface AdminProjectRow extends Project {
  owner: UserRef | null;
  space: SpaceSummary | null;
}

export interface AdminMaterialRow extends Material {
  owner: UserRef | null;
  project: { id: string; name: string | null };
  space: { id: string; name: string | null };
}

export interface SystemHealth {
  status: "ok" | "degraded";
  checkedAt: string;
  api: {
    status: string;
    version: string;
    nodeVersion: string;
    environment: string;
    role: string;
    uptimeSec: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  };
  database: {
    status: "up" | "down";
    latencyMs: number | null;
    name: string;
    collections: number | null;
    objects: number | null;
    dataSizeBytes: number | null;
    storageSizeBytes: number | null;
    indexSizeBytes: number | null;
  };
  storage: { status: string; provider: string; files: number | null; totalBytes: number | null };
  ai: {
    status: "up" | "degraded" | "not_configured";
    provider: string;
    models: { primary: string; fallbacks: string[]; light: string; lightFallbacks: string[]; embedding: string };
    inFlight: number;
    breakers: GatewayBreaker[];
    last24h: { calls: number; errors: number; errorRate: number; costUsd: number; avgLatencyMs: number | null };
  };
  worker: {
    status: "up" | "down";
    alive: number;
    workers: WorkerInfo[];
    queue: { queued: number | null; running: number | null; failed24h: number | null; oldestQueuedSec: number };
  };
  retrieval: {
    status: "up" | "degraded" | "fallback";
    vectorIndex: { status: string; checkedAt: number; detail: string | null };
    mode: string;
    chunks: number | null;
    concepts: number | null;
  };
}

export interface GatewayBreaker {
  model: string;
  failures: number;
  open: boolean;
  reopensInSec: number;
  lastError: string | null;
}

export interface WorkerInfo {
  id: string;
  host: string;
  pid: number;
  role: string;
  version: string;
  startedAt: string;
  lastBeatAt: string;
  alive: boolean;
  concurrency: number;
  running: number;
  processed: number;
  failed: number;
}

// ── Admin: AI observability ───────────────────────────────────────────────
export type Range = "24h" | "7d" | "30d";

export interface UsageGroup {
  key: string;
  calls: number;
  errors: number;
  errorRate: number;
  fallbackRate: number;
  retries: number;
  tokens: { input: number; output: number; thinking: number; total: number };
  costUsd: number;
  avgLatencyMs: number | null;
  avgTtftMs: number | null;
  p50LatencyMs?: number | null;
  p95LatencyMs?: number | null;
}

export interface AiCallSummary {
  id: string;
  feature: string;
  operation: string;
  model: string | null;
  status: "success" | "error";
  errorKind: string | null;
  errorMessage: string | null;
  latencyMs: number;
  ttftMs: number | null;
  tokens: number;
  costUsd: number;
  fallbackUsed: boolean;
  retries: number;
  promptVersion: string | null;
  inputPreview: string | null;
  ownerId: string | null;
  projectId: string | null;
  messageId: string | null;
  jobId: string | null;
  traceId: string | null;
  createdAt: string;
  user?: UserRef | null;
}

export interface AiOverview {
  range: Range;
  totals: UsageGroup;
  byFeature: UsageGroup[];
  byModel: UsageGroup[];
  series: Array<{ bucket: string; calls: number; errors: number; costUsd: number; tokens: number }>;
  topUsers: Array<{ user: UserRef; calls: number; costUsd: number; tokens: number }>;
  recentErrors: AiCallSummary[];
  gateway: { provider: string; chains: Record<string, string[]>; inFlight: number; breakers: GatewayBreaker[] };
}

export interface AiCallDetail {
  call: AiCallSummary & {
    provider: string;
    attempts: Array<{ model: string; status: string; kind?: string; ms: number; message?: string }>;
    usage: { inputTokens: number; outputTokens: number; thinkingTokens: number; totalTokens: number; estimated: boolean };
    outputPreview: string | null;
    metadata: Record<string, unknown>;
  };
  user: UserRef | null;
  project: { id: string; name: string } | null;
  related: AiCallSummary[];
  job: { id: string; type: string; status: string; attempts: number; lastError: { code: string; message: string } | null } | null;
  message: {
    id: string;
    question: string | null;
    content: string;
    status: string;
    intent: string | null;
    grounding: TutorMessage["grounding"];
    metrics: Record<string, unknown>;
    toolCalls: Array<{ name: string; ok: boolean; summary: string; args: Record<string, unknown>; error: string | null; latencyMs: number }>;
    sources: Array<Pick<TutorSource, "ref" | "materialTitle" | "pageStart" | "pageEnd" | "score" | "origin" | "cited" | "flagged" | "snippet">>;
    trace: Record<string, unknown>;
    promptVersion: string | null;
    feedback: { rating: string; reason: string | null; comment: string | null } | null;
  } | null;
}

export interface EvaluationRow {
  id: string;
  subjectType: string;
  subjectId: string | null;
  evaluator: "rules" | "llm_judge" | "learner_feedback" | "offline_suite";
  feature: string;
  verdict: "pass" | "warn" | "fail";
  scores: Record<string, number>;
  flags: string[];
  rationale: string | null;
  inputPreview: string | null;
  outputPreview: string | null;
  aiCallId: string | null;
  promptVersion: string | null;
  model: string | null;
  createdAt: string;
  user?: UserRef | null;
}

export interface EvalRunSummary {
  id: string;
  suite: string;
  label: string | null;
  provider: string;
  models: Record<string, string>;
  promptVersions: Record<string, string>;
  summary: { cases: number; passed: number; failed: number; passRate: number; metrics: Record<string, number> };
  durationMs: number;
  createdAt: string;
}

export interface EvaluationOverview {
  range: Range;
  evaluators: Array<{ evaluator: string; total: number; pass: number; warn: number; fail: number; passRate: number | null }>;
  judge: { samples: number; groundedness: number | null; citationAccuracy: number | null; relevance: number | null; pedagogy: number | null; unsupportedHandling: number | null } | null;
  byPromptVersion: Array<{ promptVersion: string; samples: number; groundedness: number | null; citationAccuracy: number | null; passRate: number | null }>;
  topRuleFailures: Array<{ rule: string; count: number }>;
  groundingDistribution: Array<{ status: string; count: number }>;
  series: Array<{ bucket: string; pass: number; warn: number; fail: number }>;
  recentFailures: EvaluationRow[];
  offlineRuns: EvalRunSummary[];
}

export interface EvalRunDetail extends EvalRunSummary {
  config: Record<string, unknown>;
  retrieval?: Array<{ id: string; query: string; rank: number; topScore: number; sufficiency: string }>;
  cases: Array<{
    id: string;
    category: string;
    question: string;
    passed: boolean;
    checks: Array<{ name: string; passed: boolean; detail?: string }>;
    grounding: string | null;
    answerPreview?: string;
    citedPages: string[];
    latencyMs: number;
  }>;
}

export interface AiConfiguration {
  provider: string;
  models: { primary: string[]; light: string[]; embedding: { model: string; dimensions: number } };
  tutor: { reasoning: string; judgeSampleRate: number };
  retrieval: { strongScore: number; minScore: number; vectorSearch: boolean };
  promptVersions: Record<string, string>;
  features: string[];
  tools: Array<{ name: string; mutates: boolean; maxCallsPerTurn: number }>;
  contextProviders: Array<{ id: string; priority: number; purposes: string[] | "all" }>;
}

export interface JobRow {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedBy: string | null;
  progress: { stage: string | null; pct: number };
  lastError: { code: string; message: string; retryable: boolean; at: string } | null;
  ownerId: string | null;
  projectId: string | null;
  idempotencyKey: string;
  durationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  user?: UserRef | null;
}

export interface JobsOverview {
  queue: { dueNow: number; delayed: number; running: number; oldestQueuedSec: number };
  last24h: { succeeded: number; failed: number; cancelled: number };
  byType: Array<{ type: string; queued: number; running: number; succeeded: number; failed: number; cancelled: number; avgDurationMs: number | null }>;
  recentFailures: JobRow[];
  workers: { alive: number; workers: WorkerInfo[] };
}

export interface JobDetail {
  job: JobRow & {
    payload: Record<string, unknown>;
    result: Record<string, unknown> | null;
    errorHistory: Array<{ code: string; message: string; retryable: boolean; at: string }>;
    traceId: string | null;
  };
  user: UserRef | null;
}
