// Runs before each test file's imports, so `config` is parsed from these values (never from a real .env).
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://tests-connect-explicitly-to-the-in-memory-server',
  MONGODB_DB_NAME: 'unused_in_tests',
  JWT_SECRET: 'test-only-secret-test-only-secret-0123456789',
  COOKIE_SECURE: 'false',
  BCRYPT_ROUNDS: '4',
  RATE_LIMIT_ENABLED: 'false',
  MAX_UPLOAD_MB: '1',
  LOG_LEVEL: 'silent',
  ADMIN_EMAIL: '',
  ADMIN_PASSWORD: '',
  GEMINI_API_KEY: '',
});
