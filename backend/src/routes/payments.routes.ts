import { Router } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { asyncHandler, notFoundHandler } from '../middleware/errorHandler.js';
import { authenticateDevice } from '../middleware/authenticate.js';
import { verifyHmac, webhookSignature } from '../utils/hmac.js';
import { badRequest, unauthorized } from '../utils/errors.js';
import { processPaymentWebhook } from '../services/webhookService.js';
import { requestStkPush, getPaymentStatus } from '../services/stkService.js';
import { sendPaymentReceipt } from '../services/smsService.js';

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
  }
}

export const paymentsRoutes = Router();

/**
 * Module 1 — POST /api/payments/webhook
 *
 * Receives STK payment confirmations from the telecom gateways
 * (WaafiPay/Telesom, Hormuud EVC Plus). The raw body's HMAC-SHA256
 * signature (header `x-waafi-signature` or `x-signature`) is verified
 * against TELECOM_WEBHOOK_SECRET BEFORE any processing; bad signatures
 * get 401. Processing is idempotent per invoiceId.
 */
paymentsRoutes.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const raw = req.rawBody;
    if (!raw || raw.length === 0) throw badRequest('Empty body');

    const signature = webhookSignature(req);
    if (!verifyHmac(config.telecomWebhookSecret, raw, signature)) {
      logger.warn({ path: req.path, hasSignature: Boolean(signature) }, 'webhook rejected: bad signature');
      throw unauthorized('Invalid webhook signature');
    }

    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      throw badRequest('Body is not valid JSON');
    }

    const result = await processPaymentWebhook(body);

    // Fire the automated SMS receipt (fire-and-forget; failures are logged
    // and the sale keeps sms_sent=false for manual retry).
    if (result.orderId && !result.deduplicated) {
      void sendPaymentReceipt(result.orderId).catch((err) =>
        logger.error({ err, orderId: result.orderId }, 'post-webhook SMS failed'),
      );
    }

    res.status(200).json({ status: 'OK', message: 'Webhook processed successfully' });
  }),
);

/**
 * Module 2 — POST /api/payments/stk-push
 * Body: { payerPhone, amount, orderId, provider: 'EVC_PLUS' | 'ZAAD' }
 * Device-authenticated. Dispatches the STK prompt and logs the pending
 * transaction awaiting the webhook callback.
 */
paymentsRoutes.post(
  '/stk-push',
  authenticateDevice,
  asyncHandler(async (req, res) => {
    const { status: paymentStatus, ...rest } = await requestStkPush(req.body);
    res
      .status(202)
      .json({ status: 'OK', paymentStatus, ...rest, message: 'STK prompt dispatched' });
  }),
);

/** GET /api/payments/status/:orderId — current payment state (mobile poll). */
paymentsRoutes.get(
  '/status/:orderId',
  authenticateDevice,
  asyncHandler(async (req, res) => {
    const { status: paymentStatus, ...rest } = await getPaymentStatus(req.params.orderId);
    if (paymentStatus === 'NOT_FOUND') {
      res.status(404).json({ status: 'NOT_FOUND', message: 'No STK attempt for this order' });
      return;
    }
    res.json({ status: 'OK', paymentStatus, ...rest });
  }),
);

paymentsRoutes.use(notFoundHandler);
