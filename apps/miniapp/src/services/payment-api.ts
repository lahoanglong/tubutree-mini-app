import { api } from './api';

export interface BankQr {
  orderCode: string;
  amount: number;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'FAILED';
  bank: { bin: string; name: string; accountNo: string; accountName: string };
  memo: string;
  qrString: string;
  qrImageUrl: string;
}

export const getBankQr = (code: string) =>
  api.get<BankQr>(`/payments/bank-qr/${code}`).then((r) => r.data);
