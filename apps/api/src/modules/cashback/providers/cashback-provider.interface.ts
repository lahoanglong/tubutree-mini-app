/** Sự kiện cashback đã chuẩn hoá — lõi CashbackService CHỈ làm việc với shape này. */
export interface NormalizedCashbackEvent {
  clickRef: string; // khớp CashbackClick.utmTraceId
  merchantOrderId: string; // id đơn của sàn (idempotency trong phạm vi provider)
  orderAmount: number; // VND, ≥ 0
  commission: number; // VND, ≥ 0
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  raw: unknown; // payload gốc → lưu postbackPayload
}

/** Adapter cho một mạng cashback (AccessTrade, Involve Asia, direct…). */
export interface CashbackProvider {
  readonly key: string;
  buildDeeplink(template: string, clickId: string, productUrl?: string): string;
  verifyWebhook(headers: Record<string, string | undefined>, body: unknown): boolean;
  parseWebhook(body: unknown): NormalizedCashbackEvent | null; // null = sai shape → bỏ qua
  isReconcileEnabled(): boolean;
  fetchTransactions(since: Date): Promise<NormalizedCashbackEvent[]>;
}

/** DI token gom mọi CashbackProvider (multi-provider array). */
export const CASHBACK_PROVIDERS = Symbol('CASHBACK_PROVIDERS');
