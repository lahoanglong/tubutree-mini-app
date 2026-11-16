import { NotImplementedException } from '@nestjs/common';
import type { BackendRoute, CommerceBackend } from './commerce-backend';

/**
 * Hiện thực đường MSS (hợp đồng commerce v0.9 mục 2–3): chưa làm. Cố ý KHÔNG có `@Injectable()` và không được đăng ký vào
 * module nào: wave đẩy đơn qua MSS mới viết thân hàm (PUT /orders/{code}, POST …/cancel, …/payment, …/invoice-request) và
 * cung cấp nó qua token MSS_COMMERCE_BACKEND. Lỡ gọi thì ném ngay, không âm thầm bỏ qua.
 */
export class MssBackend implements CommerceBackend {
  readonly route: BackendRoute = 'MSS';

  pushOrder(_orderId: string): Promise<void> {
    return Promise.reject(new NotImplementedException('MssBackend.pushOrder chưa được hiện thực'));
  }

  cancelOrder(_orderId: string): Promise<void> {
    return Promise.reject(new NotImplementedException('MssBackend.cancelOrder chưa được hiện thực'));
  }

  confirmPayment(_orderId: string): Promise<void> {
    return Promise.reject(new NotImplementedException('MssBackend.confirmPayment chưa được hiện thực'));
  }

  requestInvoice(_orderId: string): Promise<void> {
    return Promise.reject(new NotImplementedException('MssBackend.requestInvoice chưa được hiện thực'));
  }
}
