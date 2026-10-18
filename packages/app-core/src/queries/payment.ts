import type { HttpClient } from '../http';
import { getBankQr } from '../api/payment';

export const bankQrQuery = (http: HttpClient, code: string) => ({
  queryKey: ['bank-qr', code] as const,
  queryFn: () => getBankQr(http, code),
});
