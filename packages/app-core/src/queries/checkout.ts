import type { CouponPreviewRequest } from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import { checkoutQuote, getAddresses, getCouponPreviews } from '../api/checkout';

export const addressesQuery = (http: HttpClient) => ({ queryKey: ['addresses'] as const, queryFn: () => getAddresses(http) });
export const quoteQuery = (http: HttpClient, addressId: string, pointsToUse: number | undefined, ctvSlug: string | undefined, itemIds: string[] | undefined) => ({
  queryKey: ['quote', addressId, pointsToUse, ctvSlug, itemIds ? itemIds.join(',') : ''] as const,
  queryFn: () => checkoutQuote(http, addressId, pointsToUse, ctvSlug, itemIds),
});
/** `sig` là chữ ký đã debounce của (tham số, khoá phụ) do màn chọn mã dựng. */
export const couponPreviewsQuery = (http: HttpClient, sig: string, params: CouponPreviewRequest) => ({
  queryKey: ['coupon-previews', sig] as const,
  queryFn: () => getCouponPreviews(http, params),
});
