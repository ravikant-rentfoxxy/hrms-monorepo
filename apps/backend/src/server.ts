import { createApp } from './app';
import { env, isProd } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { ensureBucket } from './lib/storage';
import { startScheduler, stopScheduler } from './lib/scheduler';
import { registerAllJobs } from './jobs';

async function main(): Promise<void> {
  await prisma.$connect();
  logger.info('connected to PostgreSQL');
  await ensureBucket();
  logger.info('MinIO bucket ready');

  // Jobs are always registered (the admin "Scheduled jobs" page lists them); only enabled instances run them.
  registerAllJobs();
  if (env.SCHEDULER_ENABLED) startScheduler();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`HRMS API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
    if (!isProd) logger.info(`API docs: http://localhost:${env.PORT}/api/docs`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopScheduler();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(err, 'failed to start server');
  process.exit(1);
});
