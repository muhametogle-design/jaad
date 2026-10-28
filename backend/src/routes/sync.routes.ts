import { Router } from 'express';
import { authenticateDevice } from '../middleware/authenticate.js';
import { asyncHandler, notFoundHandler } from '../middleware/errorHandler.js';
import { syncOutbox, syncSchemaZod } from '../services/syncService.js';
import { badRequest } from '../utils/errors.js';

export const syncRoutes = Router();

/**
 * Module 4 — POST /api/sync/outbox
 *
 * Cloud sync from an offline-first SQLite POS terminal. The payload is a
 * JSON batch of offline transaction logs (batch intake, FIFO sales +
 * allocations, buyer credit ledger events, payments, wastage). Everything
 * is applied in ONE PostgreSQL transaction with idempotent UPSERTs;
 * duplicate order codes are detected and reported back so the device can
 * clear its local sync_queue.
 */
syncRoutes.post(
  '/outbox',
  authenticateDevice,
  asyncHandler(async (req, res) => {
    const payload = syncSchemaZod.parse(req.body);
    if (payload.deviceId !== req.deviceId) {
      throw badRequest('deviceId in payload does not match x-device-id header');
    }
    const result = await syncOutbox(payload);
    res.json({
      status: 'OK',
      deviceId: payload.deviceId,
      synced: {
        batches: result.batches,
        customers: result.customers,
        sales: result.sales,
        payments: result.payments,
        wastage: result.wastage,
      },
      skipped: { sales: result.skippedSales },
    });
  }),
);

syncRoutes.use(notFoundHandler);
