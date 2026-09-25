import type { Server } from 'node:http';
import { createApp } from './app';
import { config } from './config/env';
import { connectDatabase, disconnectDatabase } from './lib/db';
import { logger } from './lib/logger';
import { ensureAdminUser } from './modules/auth/auth.service';

async function main() {
  await connectDatabase(config.MONGODB_URI, config.MONGODB_DB_NAME);
  await ensureAdminUser();

  let server: Server | undefined;
  if (config.APP_ROLE === 'all' || config.APP_ROLE === 'api') {
    server = createApp().listen(config.PORT, () => {
      logger.info({ port: config.PORT, env: config.NODE_ENV, role: config.APP_ROLE }, 'API listening');
    });
  }
  // Phase 2: when APP_ROLE is 'all' or 'worker', the background worker and scheduler start here.

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const forceExit = setTimeout(() => process.exit(1), 20_000);
    forceExit.unref();
    try {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
      await disconnectDatabase();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled promise rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
