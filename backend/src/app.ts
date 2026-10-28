import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';

import { logger } from './logger.js';
import { getPool } from './db/pool.js';
import { asyncHandler, errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { paymentsRoutes } from './routes/payments.routes.js';
import { syncRoutes } from './routes/sync.routes.js';
import { reportingRoutes } from './routes/reporting.routes.js';

/**
 * Express app factory (kept separate from server.ts for testability —
 * supertest gets an app without binding a port).
 */
export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors());

  // Capture the RAW body for webhook HMAC verification.
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf as Buffer;
      },
    }),
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/health/ready' },
    }),
  );

  app.get('/', (_req, res) => {
    res.json({
      service: 'jaad-backend',
      status: 'OK',
      endpoints: {
        'GET /health': 'liveness',
        'GET /health/ready': 'DB readiness',
        'POST /api/payments/webhook': 'HMAC-verified telecom callback (x-waafi-signature / x-signature)',
        'POST /api/payments/stk-push': 'device-auth: dispatch EVC+ / Zaad STK prompt',
        'GET /api/payments/status/:orderId': 'device-auth: payment state poll',
        'POST /api/sync/outbox': 'device-auth: offline batch sync (SQLite → PostgreSQL)',
        'GET /api/reporting/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD': 'device-auth: P&L aggregation',
        'GET /api/reporting/orders/:orderCode': 'device-auth: order audit (FIFO + STK)',
      },
      auth: 'device routes require x-device-key + x-device-id (see DEVICE_API_KEYS)',
    });
  });
  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', uptime: Math.round(process.uptime()) });
  });
  app.get(
    '/health/ready',
    asyncHandler(async (_req, res) => {
      await getPool().query('SELECT 1');
      res.json({ status: 'OK', db: 'up' });
    }),
  );

  app.use('/api/payments', paymentsRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/reporting', reportingRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
