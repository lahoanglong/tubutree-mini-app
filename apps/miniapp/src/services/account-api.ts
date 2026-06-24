import { api } from './api';
import type { AddressDTO } from './shop-api';

/** Loyalty overview (§6.6) — hạng hiện tại, tiến độ lên hạng kế. */
export interface LoyaltyOverview {
  pointsBalance: number;
  tier: { id: string; name: string; multiplier: number; perks: unknown } | null;
  nextTier: { id: string; name: string; minPoints: number; pointsToGo: number } | null;
  tiers: { id: string; name: string; minPoints: number; multiplier: number }[];
}

export interface PointsTxn {
  id: string;
  delta: number;
  reason: string;
  refType: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CouponDTO {
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  endAt: string;
}

export interface WalletSummary {
  walletBalance: number;
  coinsBalance: number;
  cashbackPending: number;
  commissionApproved: number;
  commissionPending: number;
  xuConvertMultiplier: number;
  withdrawMin: number;
  withdrawFee: number;
}

export interface CoinTxn {
  id: string;
  delta: number;
  reason: string;
  refType: string | null;
  createdAt: string;
}

export interface CoinsOverview {
  coinsBalance: number;
  referralCode: string;
  referralEarned: number;
  referralSuccessCount: number;
  transactions: CoinTxn[];
}

export interface BankInfo {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

// Me / onboarding
export interface MeProfile {
  id: string;
  fullName: string | null;
  email: string | null;
  dob: string | null;
  onboarded: boolean;
  segments: string[];
}
export const getMe = () => api.get<MeProfile>('/me').then((r) => r.data);
export const updateMe = (data: { fullName?: string; email?: string; dob?: string }) =>
  api.patch<MeProfile>('/me', data).then((r) => r.data);
export const completeOnboarding = (segments: string[]) =>
  api.post<MeProfile>('/me/onboarding', { segments }).then((r) => r.data);

// Loyalty
export const getLoyalty = () => api.get<LoyaltyOverview>('/me/loyalty').then((r) => r.data);
export const getPointsTransactions = () =>
  api.get<PointsTxn[]>('/me/points/transactions').then((r) => r.data);
export const getCoupons = () => api.get<CouponDTO[]>('/me/coupons').then((r) => r.data);

// Wallet
export const getWallet = () => api.get<WalletSummary>('/me/wallet').then((r) => r.data);
export const withdraw = (amount: number, bankInfo: BankInfo) =>
  api
    .post<{ ok: boolean; payoutId: string; status: string; withdrawn: number; fee: number; net: number }>(
      '/wallet/withdraw',
      { amount, bankInfo },
    )
    .then((r) => r.data);

// TubuXu
export const getCoins = () => api.get<CoinsOverview>('/me/coins').then((r) => r.data);
export const convertToXu = (amount: number) =>
  api
    .post<{ spent: number; received: number; multiplier: number }>('/wallet/convert-xu', { amount })
    .then((r) => r.data);

// Notifications
export interface NotificationDTO {
  id: string;
  templateCode: string;
  payload: { body?: string; data?: Record<string, string> };
  status: 'SENT' | 'FAILED' | 'READ';
  sentAt: string;
}
export const getNotifications = () =>
  api.get<NotificationDTO[]>('/me/notifications').then((r) => r.data);
export const markNotificationRead = (id: string) =>
  api.post<{ ok: boolean }>(`/me/notifications/${id}/read`).then((r) => r.data);

// Addresses (bổ sung update/delete cho address book)
export const updateAddress = (id: string, data: Partial<Omit<AddressDTO, 'id'>>) =>
  api.patch<AddressDTO>(`/me/addresses/${id}`, data).then((r) => r.data);
export const deleteAddress = (id: string) =>
  api.delete<{ ok: boolean }>(`/me/addresses/${id}`).then((r) => r.data);
