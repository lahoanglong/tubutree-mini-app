import type { HttpClient } from '../http';
import { syncServerClock } from '../server-clock';

export interface BankQr {
  orderCode: string;
  amount: number;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'FAILED';
  /** Hạn chuyển khoản (ISO); quá hạn đơn tự huỷ. Null khi đơn không còn chờ tiền hoặc API bản cũ. */
  paymentDeadline?: string | null;
  /** Giờ máy chủ lúc trả lời; thiếu thì app dùng đồng hồ máy khách. */
  serverNow?: string;
  bank: { bin: string; name: string; accountNo: string; accountName: string };
  memo: string;
  qrString: string;
  qrImageUrl: string;
}
export const getBankQr = async (http: HttpClient, code: string) => {
  const qr = await http.get<BankQr>(`/payments/bank-qr/${code}`);
  syncServerClock(qr?.serverNow);
  return qr;
};
