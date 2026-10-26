import { config } from './config.js';
import { logger } from './logger.js';
import { createApp } from './app.js';
import { getPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';

async function main(): Promise<void> {
  if (config.runMigrations) {
    logger.info('running database migrations');
    await runMigrations();
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv, sms: config.sms.provider },
      'jaad-backend listening',
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void getPool()
        .end()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
    // Hard exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
