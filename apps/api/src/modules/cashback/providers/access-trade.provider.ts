import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from '../../../config/env.validation';
import type { CashbackProvider, NormalizedCashbackEvent } from './cashback-provider.interface';

/** Shape postback / transaction của AccessTrade (đặc thù vendor — không rò rỉ ra lõi). */
interface AccesstradePayload {
  utm_content: string; // clickId
  order_id: string;
  amount: number;
  commission: number;
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * Adapter AccessTrade. Reconcile gate bằng ACCESSTRADE_TOKEN (chưa cấu hình → no-op).
 * verifyWebhook: fail-closed ở production khi chưa có secret; dev bỏ qua cho dễ thử.
 */
@Injectable()
export class AccessTradeProvider implements CashbackProvider {
  readonly key = 'accesstrade';
  private readonly logger = new Logger(AccessTradeProvider.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly webhookSecret: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('ACCESSTRADE_BASE_URL', { infer: true });
    this.token = config.get('ACCESSTRADE_TOKEN', { infer: true });
    this.webhookSecret = config.get('ACCESSTRADE_WEBHOOK_SECRET', { infer: true });
  }

  buildDeeplink(template: string, clickId: string, productUrl?: string): string {
    let url = template.replaceAll('{{clickId}}', clickId);
    if (productUrl) url += `${url.includes('?') ? '&' : '?'}url=${encodeURIComponent(productUrl)}`;
    return url;
  }

  verifyWebhook(headers: Record<string, string | undefined>, _body?: unknown): boolean {
    // Chưa cấu hình secret: dev cho qua, production từ chối (env.validation cũng ép secret ở prod).
    if (!this.webhookSecret) return process.env.NODE_ENV !== 'production';
    return this.tokenMatches(headers['x-accesstrade-token']);
  }

  parseWebhook(body: unknown): NormalizedCashbackEvent | null {
    const p = body as Partial<AccesstradePayload> | null;
    if (!p || typeof p.utm_content !== 'string' || typeof p.order_id !== 'string') return null;
    if (typeof p.amount !== 'number' || typeof p.commission !== 'number') return null;
    if (!Number.isInteger(p.amount) || !Number.isInteger(p.commission)) return null;
    if (p.amount < 0 || p.commission < 0) return null; // chống cộng số dư âm (forge/bug)
    const status = p.status === 'approved' ? 'CONFIRMED' : p.status === 'rejected' ? 'REJECTED' : 'PENDING';
    return {
      clickRef: p.utm_content,
      merchantOrderId: p.order_id,
      orderAmount: p.amount,
      commission: p.commission,
      status,
      raw: body,
    };
  }

  isReconcileEnabled(): boolean {
    return Boolean(this.token);
  }

  /** Kéo giao dịch gần đây để đối soát (bắt postback rớt). Gated bằng token. */
  async fetchTransactions(since: Date): Promise<NormalizedCashbackEvent[]> {
    if (!this.token) return [];
    const { data } = await axios.get(`${this.baseUrl.replace(/\/$/, '')}/transactions`, {
      headers: { Authorization: `Bearer ${this.token}` },
      params: { since: since.toISOString() },
      timeout: 30000,
    });
    const rows: unknown[] = Array.isArray(data?.data) ? data.data : [];
    return rows
      .map((r) => this.parseWebhook(r))
      .filter((e): e is NormalizedCashbackEvent => e !== null);
  }

  private tokenMatches(token?: string): boolean {
    if (!token) return false;
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(this.webhookSecret, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
