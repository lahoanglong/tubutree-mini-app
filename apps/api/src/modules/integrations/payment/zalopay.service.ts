import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { Env } from '../../../config/env.validation';

/**
 * ZaloPay v2 (Build Spec §10.1). Tạo đơn → trả order_url + zp_trans_token cho SDK mini app.
 * Webhook (callback) verify MAC bằng key2 → set Order PAID.
 * Gate bằng ZALOPAY_APP_ID; chưa cấu hình → 503 (dev dùng COD).
 */
@Injectable()
export class ZalopayService {
  private readonly logger = new Logger(ZalopayService.name);
  private readonly appId: string;
  private readonly key1: string;
  private readonly key2: string;
  private readonly endpoint: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.appId = config.get('ZALOPAY_APP_ID', { infer: true });
    this.key1 = config.get('ZALOPAY_KEY1', { infer: true });
    this.key2 = config.get('ZALOPAY_KEY2', { infer: true });
    this.endpoint = config.get('ZALOPAY_ENDPOINT', { infer: true });
  }

  private isConfigured(): boolean {
    return Boolean(this.appId && this.key1 && this.key2);
  }

  async createPayment(userId: string, orderCode: string) {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('ZaloPay chưa được cấu hình.');
    }
    const order = await this.prisma.order.findUnique({ where: { code: orderCode } });
    if (!order || order.userId !== userId) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (order.paymentStatus === 'PAID') throw new BadRequestException('Đơn đã thanh toán.');

    const appTime = Date.now();
    const appTransId = `${this.yymmdd()}_${order.code}`;
    const embedData = JSON.stringify({ orderCode: order.code });
    const items = JSON.stringify([{ itemid: order.code, itemprice: order.total, itemquantity: 1 }]);
    const appUser = userId;

    // mac = HMAC-SHA256(key1, app_id|app_trans_id|app_user|amount|app_time|embed_data|item)
    const dataStr = [this.appId, appTransId, appUser, order.total, appTime, embedData, items].join('|');
    const mac = createHmac('sha256', this.key1).update(dataStr).digest('hex');

    const payload = {
      app_id: Number(this.appId),
      app_trans_id: appTransId,
      app_user: appUser,
      app_time: appTime,
      amount: order.total,
      item: items,
      embed_data: embedData,
      description: `Tubu Tree - Thanh toán đơn ${order.code}`,
      bank_code: '',
      mac,
    };

    const { data } = await axios.post(`${this.endpoint}/create`, null, {
      params: payload,
      timeout: 12000,
    });
    await this.prisma.order.update({
      where: { id: order.id },
      data: { paymentTxnId: appTransId },
    });
    return data as { order_url?: string; zp_trans_token?: string; return_code?: number };
  }

  /** Webhook ZaloPay: verify MAC key2 → set PAID. */
  async handleCallback(rawData: string, reqMac: string) {
    if (!this.isConfigured()) return { return_code: 2, return_message: 'not configured' };
    const mac = createHmac('sha256', this.key2).update(rawData).digest('hex');
    if (!this.safeEqual(mac, reqMac)) {
      this.logger.warn('ZaloPay callback MAC mismatch.');
      return { return_code: -1, return_message: 'mac not equal' };
    }
    const data = JSON.parse(rawData) as { app_trans_id: string };
    const order = await this.prisma.order.findFirst({
      where: { paymentTxnId: data.app_trans_id },
    });
    if (order && order.paymentStatus !== 'PAID') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'PAID', status: order.status === 'PENDING_PAYMENT' ? 'CONFIRMED' : order.status },
      });
      await this.notifications.notify(order.userId, 'ORDER_CONFIRMED', { order_code: order.code });
    }
    return { return_code: 1, return_message: 'success' };
  }

  /** So sánh MAC chống timing-attack (độ dài khác → false ngay, không ném). */
  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }

  private yymmdd(): string {
    const d = new Date();
    return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }
}
