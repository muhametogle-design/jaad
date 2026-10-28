import { Router } from 'express';
import { authenticateDevice } from '../middleware/authenticate.js';
import { asyncHandler, notFoundHandler } from '../middleware/errorHandler.js';
import { pnlBetween, orderAudit } from '../services/pnlService.js';

export const reportingRoutes = Router();

/**
 * Financial auditing & real-time P&L aggregation.
 *
 * GET /api/reporting/pnl?from=2026-10-01&to=2026-10-16&deviceId=POS-HGA-01
 * GET /api/reporting/orders/:orderCode   (full audit trail incl. FIFO slices)
 */
reportingRoutes.get(
  '/pnl',
  authenticateDevice,
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    res.json({ status: 'OK', pnl: await pnlBetween(from, to, deviceId) });
  }),
);

reportingRoutes.get(
  '/orders/:orderCode',
  authenticateDevice,
  asyncHandler(async (req, res) => {
    res.json({ status: 'OK', ...(await orderAudit(req.params.orderCode)) });
  }),
);

reportingRoutes.use(notFoundHandler);
