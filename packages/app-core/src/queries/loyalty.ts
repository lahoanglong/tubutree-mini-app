import type { HttpClient } from '../http';
import {
  getCoupons,
  getDailyCheckInStatus,
  getLoyalty,
  getLoyaltyRewards,
  getMemberCard,
  getMyRedemptions,
  getNewCustomerOffer,
  getPointsTransactions,
  getReferral,
} from '../api/loyalty';
import { WASTE_QUERY_KEYS } from '../api/waste';

export const loyaltyQuery = (http: HttpClient) => ({ queryKey: ['loyalty'] as const, queryFn: () => getLoyalty(http) });
export const couponsQuery = (http: HttpClient) => ({ queryKey: ['coupons'] as const, queryFn: () => getCoupons(http) });
export const pointsTxnQuery = (http: HttpClient) => ({ queryKey: ['points-txn'] as const, queryFn: () => getPointsTransactions(http) });
export const checkInQuery = (http: HttpClient) => ({ queryKey: ['loyalty-checkin'] as const, queryFn: () => getDailyCheckInStatus(http) });
export const memberCardQuery = (http: HttpClient) => ({ queryKey: ['loyalty-member-card'] as const, queryFn: () => getMemberCard(http) });
export const referralQuery = (http: HttpClient) => ({ queryKey: ['referral'] as const, queryFn: () => getReferral(http) });
export const newCustomerOfferQuery = (http: HttpClient, userId: string | undefined) => ({
  queryKey: ['new-customer-offer', userId] as const,
  queryFn: () => getNewCustomerOffer(http),
});
export const rewardsQuery = (http: HttpClient) => ({ queryKey: WASTE_QUERY_KEYS.rewards, queryFn: () => getLoyaltyRewards(http) });
export const myRedemptionsQuery = (http: HttpClient) => ({ queryKey: WASTE_QUERY_KEYS.rewardsMine, queryFn: () => getMyRedemptions(http) });
