import { api } from './api';
import { syncServerClock } from '../utils/server-clock';

export interface BankQr {
  orderCode: string;
  /** Số cần chuyển nốt: tổng đơn trừ phần Tubu đã nhận. */
  amount: number;
  /** Số Tubu đã nhận khi khách chuyển thiếu; thiếu hoặc 0 = chưa nhận đồng nào (API bản cũ không trả). */
  paidSoFar?: number;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'FAILED';
  /** Hạn chuyển khoản (ISO); quá hạn đơn tự huỷ. Null khi đơn không còn chờ tiền hoặc API bản cũ. */
  paymentDeadline?: string | null;
  /** Giờ máy chủ lúc trả lời; thiếu = API cũ, app dùng đồng hồ điện thoại. */
  serverNow?: string;
  bank: { bin: string; name: string; accountNo: string; accountName: string };
  memo: string;
  qrString: string;
  qrImageUrl: string;
}

export const getBankQr = (code: string) =>
  api.get<BankQr>(`/payments/bank-qr/${code}`).then((r) => {
    syncServerClock(r.data.serverNow);
    return r.data;
  });
