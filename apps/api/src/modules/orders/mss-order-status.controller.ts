import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MssSignedRoute } from '../integrations/mss/mss-inbound.guard';
import { MssPaymentRescueService, type PaymentRescueResult } from './mss-payment-rescue.service';

const ORDER_CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface MssOrderStatusInput {
  orderCode: string;
  /** Chỉ `"overdue"` ở hợp đồng W4-02; khối thiếu, sai dạng hay trạng thái lạ thì null (bên nhận bỏ qua khối không biết). */
  paymentRescue: { state: 'overdue' } | null;
}

/**
 * Đọc thân webhook `order-status` (hợp đồng commerce mục 2.4 + khối `payment_rescue` của W4-02) bằng tay: chỉ `order_code` là bắt buộc,
 * khoá lạ MSS thêm sau không làm 400. Phần trạng thái (`status`, `pancake`, `shipping`, `attention`) chỉ dành cho đơn đi đường MSS, mà
 * Tubu chưa đẩy đơn nào qua MSS (MssBackend chưa hiện thực), nên chưa đọc.
 */
export function parseMssOrderStatus(body: unknown): MssOrderStatusInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.order_code !== 'string' || !ORDER_CODE_RE.test(b.order_code)) return null;
  const rescue = b.payment_rescue;
  const overdue = !!rescue && typeof rescue === 'object' && !Array.isArray(rescue) && (rescue as Record<string, unknown>).state === 'overdue';
  return { orderCode: b.order_code, paymentRescue: overdue ? { state: 'overdue' } : null };
}

export type MssOrderStatusReply = { ok: true } & (PaymentRescueResult | { outcome: 'ignored' });

/**
 * MSS báo trạng thái đơn (`POST /api/integrations/mss/order-status`), chỉ sau MssInboundGuard: HMAC trên thân thô, lệch giờ tối đa 300
 * giây. MSS gửi khối `payment_rescue` một lần khi case chờ chuyển khoản sang QUÁ HẠN; Tubu quyết huỷ ở MssPaymentRescueService. Mọi
 * nhánh không lỗi đều trả 200 (kể cả đơn lạ, đã huỷ, chưa tới hạn, cờ tắt) để MSS thôi gửi lại; lỗi DB thì 5xx để MSS thử lại, an toàn
 * vì lần huỷ chỉ thắng một lần theo trạng thái đơn.
 */
@Controller('integrations/mss')
@MssSignedRoute()
@SkipThrottle()
export class MssOrderStatusController {
  constructor(private readonly rescue: MssPaymentRescueService) {}

  @Post('order-status')
  @HttpCode(200)
  async orderStatus(@Body() body: unknown): Promise<MssOrderStatusReply> {
    const input = parseMssOrderStatus(body);
    if (!input) throw new BadRequestException({ error: 'invalid_body', message: 'invalid_body' });
    if (!input.paymentRescue) return { ok: true, outcome: 'ignored' };
    return { ok: true, ...(await this.rescue.handleOverdue(input.orderCode)) };
  }
}
