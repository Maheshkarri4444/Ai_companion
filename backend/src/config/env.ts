import { z } from 'zod';

/** Treat blank env values (`FOO=`) as "not set". */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const booleanish = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const v = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off', ''].includes(v)) return false;
  return value;
}, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  APP_VERSION: z.string().default('0.1.0'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().min(1).default('ai_study_companion'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'COOKIE_NAME may only contain letters, digits, _ and -')
    .default('asc_session'),
  COOKIE_SECURE: booleanish.default(false),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
  RATE_LIMIT_ENABLED: booleanish.default(true),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(20),

  ADMIN_EMAIL: z.preprocess(blankToUndefined, z.email().optional()),
  ADMIN_PASSWORD: z.preprocess(blankToUndefined, z.string().min(8).max(72).optional()),
  ADMIN_NAME: z.string().min(2).max(80).default('Platform Admin'),

  AI_PROVIDER: z.enum(['gemini', 'mock']).default('gemini'),
  GEMINI_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  AI_MODEL_PRIMARY: z.string().default('gemini-3.6-flash'),
  AI_MODEL_FALLBACKS: z.string().default('gemini-3.7-flash,gemini-3-flash-preview,gemini-3.5-flash-lite'),
  AI_MODEL_LIGHT: z.string().default('gemini-3.5-flash-lite'),
  AI_MODEL_LIGHT_FALLBACKS: z.string().default('gemini-3.1-flash-lite,gemini-3-flash-preview'),
  AI_EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
  AI_EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  AI_TUTOR_REASONING: z.enum(['minimal', 'low', 'medium', 'high']).default('minimal'),

  /**
   * Cosine thresholds for retrieval sufficiency, calibrated for gemini-embedding-2 with the tutor eval suite
   * (2026-09-25): answerable questions scored 0.77–0.85, partially covered 0.70, adjacent-but-uncovered topics
   * 0.63, off-topic 0.53–0.56. Below MIN no model is asked to answer; between MIN and STRONG the model
   * decides and must self-report PARTIAL/INSUFFICIENT.
   */
  RETRIEVAL_STRONG_SCORE: z.coerce.number().min(0).max(1).default(0.72),
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.58),
  VECTOR_SEARCH_ENABLED: booleanish.default(true),
  TUTOR_JUDGE_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.3),
  /** Share of generated quiz questions reviewed by the LLM judge (plus every question with rule warnings). */
  QUIZ_JUDGE_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.2),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

type Env = z.infer<typeof EnvSchema>;

export type Config = Env & {
  isProduction: boolean;
  isTest: boolean;
  corsOrigins: string[];
  maxUploadBytes: number;
  aiFallbackModels: string[];
  aiLightFallbackModels: string[];
};

function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`);
    // The logger depends on config, so report directly and stop: running misconfigured is worse than not running.
    console.error(`\nInvalid environment configuration:\n${problems.join('\n')}\n`);
    process.exit(1);
  }
  const env = parsed.data;
  const splitList = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    corsOrigins: splitList(env.CORS_ORIGINS),
    maxUploadBytes: Math.round(env.MAX_UPLOAD_MB * 1024 * 1024),
    aiFallbackModels: splitList(env.AI_MODEL_FALLBACKS),
    aiLightFallbackModels: splitList(env.AI_MODEL_LIGHT_FALLBACKS),
  };
}

export const config = loadConfig();
