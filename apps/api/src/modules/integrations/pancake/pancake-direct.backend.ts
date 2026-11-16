import { Injectable } from '@nestjs/common';
import type { BackendRoute, CommerceBackend } from '../mss/commerce-backend';
import { PancakeOrderService } from './pancake-order.service';

/**
 * Đường Pancake trực tiếp hiện có, bọc sau interface CommerceBackend (hợp đồng commerce v0.9 mục 0.3). Chỉ chuyển tiếp tới đúng
 * các hàm xếp việc sẵn có của PancakeOrderService: không đổi logic, không đổi hàng đợi, không đổi luật chặn đẩy.
 */
@Injectable()
export class PancakeDirectBackend implements CommerceBackend {
  readonly route: BackendRoute = 'PANCAKE_DIRECT';

  constructor(private readonly orders: PancakeOrderService) {}

  pushOrder(orderId: string): Promise<void> {
    return this.orders.enqueuePush(orderId);
  }

  cancelOrder(orderId: string): Promise<void> {
    return this.orders.enqueueCancel(orderId);
  }

  confirmPayment(orderId: string): Promise<void> {
    return this.orders.enqueuePayment(orderId);
  }

  /** Đường Pancake gửi yêu cầu hoá đơn ngay trong thân tạo đơn (`extension.invoice_request`, pancake-order-body.ts): không có lệnh riêng. */
  requestInvoice(_orderId: string): Promise<void> {
    return Promise.resolve();
  }
}
