import { api } from './api';
import type { OrderDTO } from '@tubutree/shared-types';

export type DealerStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface DealerMe {
  isDealer: boolean;
  status: DealerStatus;
  tier: { id: string; name: string; creditLimit: number } | null;
  currentDebt: number;
}

export interface DealerApplyInput {
  businessName: string;
  taxCode?: string;
  ownerName: string;
  phone: string;
  address: string;
  cccdFrontUrl: string;
  cccdBackUrl: string;
  storeFrontUrl?: string;
  monthlyVolumeEstimate?: number;
  notes?: string;
}

export interface PricelistRow {
  variationId: string;
  sku: string;
  product: string;
  brand: string;
  variation: string;
  retailPrice: number;
  dealerPrice: number;
  discountPct: number;
  stock: number;
}

export interface CreditEntry {
  id: string;
  delta: number;
  refType: string;
  note: string | null;
  createdAt: string;
}

export const getDealerMe = () => api.get<DealerMe>('/dealer/me').then((r) => r.data);
export const applyDealer = (data: DealerApplyInput) =>
  api.post('/dealer/apply', data).then((r) => r.data);
export const getPricelist = () => api.get<PricelistRow[]>('/dealer/pricelist').then((r) => r.data);
export const placeDealerOrder = (
  items: { variationId: string; quantity: number }[],
  paymentMethod: 'CREDIT' | 'PREPAID',
  note?: string,
) => api.post<OrderDTO>('/dealer/orders', { items, paymentMethod, note }).then((r) => r.data);
export const getDealerOrders = () => api.get<OrderDTO[]>('/dealer/orders').then((r) => r.data);
export const getCreditLedger = () =>
  api.get<{ balance: number; entries: CreditEntry[] }>('/dealer/credit-ledger').then((r) => r.data);
export const payCredit = (amount: number, note?: string) =>
  api.post<{ ok: boolean }>('/dealer/credit-payment', { amount, note }).then((r) => r.data);
