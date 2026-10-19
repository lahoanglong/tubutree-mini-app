import type { HttpClient } from '../http';

export interface ClaimedCoupon {
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  endAt: string;
  newCustomerOnly: boolean;
  alreadyClaimed: boolean;
}

export const claimCoupon = (http: HttpClient, code: string) => http.post<ClaimedCoupon>('/coupons/claim', { code });
