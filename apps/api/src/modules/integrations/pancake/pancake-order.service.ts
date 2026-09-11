import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { PancakeClient } from './pancake.client';
import type { PancakeCreateOrderBody } from './pancake.types';
import { QUEUE_PANCAKE_PUSH } from '../../../jobs/queues';

interface ShippingSnapshot {
  recipient: string;
  phone: string;
  street: string;
  ward: string;
  district: string;
  province: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
}

/**
 * Đẩy đơn local → Pancake (Build Spec §8.3). Idempotent: nếu order đã có
 * pancakeOrderId thì bỏ qua. Khi Pancake chưa cấu hình (dev) → đánh dấu pending,
 * job/retry sau sẽ đẩy (ở đây trả về null, không chặn checkout).
 */
@Injectable()
export class PancakeOrderService {
  private readonly logger = new Logger(PancakeOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PancakeClient,
    @InjectQueue(QUEUE_PANCAKE_PUSH) private readonly pushQueue: Queue,
  ) {}

  /**
   * Xếp hàng đẩy đơn → Pancake, có retry+backoff (5 lần, xem jobs/queue.module.ts) qua
   * PancakePushProcessor — thay cho gọi pushOrder() trực tiếp rồi log-nuốt lỗi (P0-2,
   * docs/2026-09-08-review-progress.md): trước đây Pancake lỗi/timeout 1 lần là đơn mất
   * vĩnh viễn, kho vật lý không bao giờ thấy dù đã trừ kho + trừ tiền khách.
   * jobId=orderId → BullMQ tự chặn trùng job cho cùng 1 đơn (dedupe) khi enqueue nhiều lần
   * (checkout gọi + cron reconcile gọi lại) trong lúc job cũ còn active/waiting.
   *
   * Xoá job cũ trước khi add, NHƯNG CHỈ KHI nó đã THẤT BẠI: BullMQ giữ job hash lại sau khi job
   * xong/thất bại (removeOnComplete 1000, removeOnFail 5000 — xem jobs/queue.module.ts), và
   * script addStandardJob trả về job cũ mà KHÔNG enqueue nếu hash cùng jobId còn tồn tại. Không
   * dọn thì đơn đã đẩy hỏng hết 5 lần thử sẽ chặn vĩnh viễn mọi lần enqueue sau — cron cứu hộ
   * 15 phút/lần in log "re-enqueue" mãi mà không có gì chạy.
   *
   * Vì sao CHỈ xoá job failed: `pushOrder` chỉ ghi `pancakeOrderId` khi Pancake trả về id
   * (dòng dưới). Nếu Pancake ĐÃ TẠO đơn nhưng response thiếu id, job vẫn "completed" trong khi
   * `pancakeOrderId` còn null — và cron cứu hộ quét đúng điều kiện đó. Xoá luôn job completed
   * thì cứ 15 phút lại tạo thêm MỘT ĐƠN TRÙNG ở kho vật lý, vô thời hạn. Giữ job completed
   * chính là chốt chặn cuối cho trường hợp này.
   */
  async enqueuePush(orderId: string): Promise<void> {
    try {
      const existing = await this.pushQueue.getJob(orderId);
      if (existing && (await existing.getState()) === 'failed') {
        await existing.remove();
      }
    } catch {
      /* không đọc được trạng thái job → cứ add, BullMQ tự dedupe */
    }
    await this.pushQueue.add('push', { orderId }, { jobId: orderId });
  }

  async pushOrder(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, user: true },
    });
    if (order.pancakeOrderId) return order.pancakeOrderId; // đã đẩy

    if (!this.client.isConfigured()) {
      this.logger.warn(`Pancake chưa cấu hình — đơn ${order.code} giữ trạng thái chờ đồng bộ.`);
      return null;
    }

    const addr = order.shippingAddress as unknown as ShippingSnapshot;
    const inv = order.invoiceRequest as unknown as
      | { taxCode: string; companyName: string; address: string; email: string }
      | null;
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: order.items.map((i) => i.variationId) } },
      select: { id: true, pancakeId: true },
    });
    const pancakeByLocal = new Map(variations.map((v) => [v.id, v.pancakeId]));

    const body: PancakeCreateOrderBody = {
      customer: {
        name: addr.recipient,
        phone_number: addr.phone,
        // Hệ 2 cấp: district có thể rỗng → bỏ phần rỗng (tránh ", ,") và KHÔNG gửi id rỗng.
        address: [addr.street, addr.ward, addr.district, addr.province].filter(Boolean).join(', '),
        ward_id: addr.wardCode || undefined,
        district_id: addr.districtCode || undefined,
        province_id: addr.provinceCode || undefined,
        fb_id: order.user.zaloId ?? undefined,
      },
      items: order.items.map((i) => ({
        variation_id: pancakeByLocal.get(i.variationId) ?? i.variationId,
        quantity: i.quantity,
        discount_each_product: 0,
      })),
      shipping_fee: order.shippingFee,
      total_discount: order.discount,
      tags: ['MINIAPP', order.type === 'DEALER' ? 'DEALER' : 'RETAIL'],
      note: `Order code: ${order.code}`,
      extension: {
        external_order_id: order.code,
        invoice_request: inv
          ? { tax_code: inv.taxCode, company_name: inv.companyName, address: inv.address, email: inv.email }
          : undefined,
      },
    };

    const res = await this.client.createOrder(body);
    const pancakeOrderId = res.id ?? res.order_id ?? null;
    if (pancakeOrderId) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { pancakeOrderId },
      });
    }
    return pancakeOrderId;
  }
}
