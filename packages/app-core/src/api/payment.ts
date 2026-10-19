import type { HttpClient } from '../http';

export interface BankQr {
  orderCode: string;
  amount: number;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'FAILED';
  /** Hạn chuyển khoản (ISO); quá hạn đơn tự huỷ. Null khi đơn không còn chờ tiền hoặc API bản cũ. */
  paymentDeadline?: string | null;
  bank: { bin: string; name: string; accountNo: string; accountName: string };
  memo: string;
  qrString: string;
  qrImageUrl: string;
}
export const getBankQr = (http: HttpClient, code: string) => http.get<BankQr>(`/payments/bank-qr/${code}`);
