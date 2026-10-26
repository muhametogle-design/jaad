export type MMProvider = 'EVC_PLUS' | 'ZAAD';

export interface StkDispatchInput {
  /** Payer phone in international format, e.g. 252611234567. */
  payerPhone: string;
  /** Amount in Somali Shillings. */
  amount: number;
  /** Mobile order id (sales.order_code) — used as the merchant reference. */
  orderId: string;
}

export interface StkDispatchResult {
  ok: boolean;
  /** Provider invoice/session id — this becomes the webhook invoiceId. */
  invoiceId?: string;
  message?: string;
  /** True when credentials are absent and a sandbox id was generated. */
  simulated?: boolean;
  raw?: unknown;
}

export interface StkGateway {
  readonly id: MMProvider;
  readonly displayName: string;
  dispatch(input: StkDispatchInput): Promise<StkDispatchResult>;
}
