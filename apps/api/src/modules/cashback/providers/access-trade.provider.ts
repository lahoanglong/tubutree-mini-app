import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { safeEqualStrings } from '../../../common/safe-equal';
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

  private static readonly STATUS_MAP = new Map<string, NormalizedCashbackEvent['status']>([
    ['pending', 'PENDING'],
    ['approved', 'CONFIRMED'],
    ['rejected', 'REJECTED'],
  ]);

  /**
   * Số tiền: chấp nhận cả chuỗi số và số thập phân rồi LÀM TRÒN, thay vì loại bỏ.
   *
   * Trước đây `commission: 15750.5` (hoa hồng lẻ, rất bình thường) hoặc `amount: "500000"`
   * (chuỗi) đều trả null → controller trả 2xx im lặng → sàn coi như đã giao, không gửi lại.
   * Khoản hoàn tiền của khách biến mất mà không có bản ghi nào và không ai biết.
   */
  private static toAmount(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isFinite(n) || n < 0) return null; // chống cộng số dư âm (forge/bug)
    return Math.round(n);
  }

  parseWebhook(body: unknown): NormalizedCashbackEvent | null {
    const p = body as Partial<AccesstradePayload> | null;
    if (!p || typeof p.utm_content !== 'string' || typeof p.order_id !== 'string') {
      this.logger.warn(`Postback thiếu utm_content/order_id — bỏ qua: ${JSON.stringify(body).slice(0, 300)}`);
      return null;
    }
    const orderAmount = AccessTradeProvider.toAmount(p.amount);
    const commission = AccessTradeProvider.toAmount(p.commission);
    if (orderAmount === null || commission === null) {
      this.logger.error(
        `Postback ${p.order_id} có số tiền không hợp lệ (amount=${String(p.amount)}, commission=${String(p.commission)}) — bỏ qua.`,
      );
      return null;
    }
    // Trạng thái lạ (vd "hold") không được đổi dòng đã có: lõi chỉ cho tạo dòng PENDING mới (không đụng tiền). Trả null ở đây thì
    // postback đầu tiên của một đơn mất hẳn, vì controller vẫn trả 2xx và sàn không gửi lại.
    const raw = typeof p.status === 'string' ? p.status : undefined;
    const mapped = raw === undefined ? undefined : AccessTradeProvider.STATUS_MAP.get(raw.trim().toLowerCase());
    const unknownStatus = mapped ? undefined : String(p.status);
    if (unknownStatus !== undefined) this.logger.warn(`Postback ${p.order_id} có trạng thái lạ (${unknownStatus}) — chỉ tạo dòng PENDING nếu chưa có.`);
    const status = mapped ?? 'PENDING';
    return {
      clickRef: p.utm_content,
      merchantOrderId: p.order_id,
      orderAmount,
      commission,
      status,
      ...(unknownStatus !== undefined ? { unknownStatus } : {}),
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
    return safeEqualStrings(token, this.webhookSecret);
  }
}
