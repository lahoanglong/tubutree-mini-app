'use client';

import { useQuery } from '@tanstack/react-query';
import { welcomeOfferOf, type WelcomeOffer } from '@tubutree/app-core/commerce/share-offer';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { coreHttp } from '@/lib/core-http';

/**
 * Mã chào mừng thật (Admin đặt) cho lời chia sẻ; chưa tải xong hoặc API cũ thì null và lời chia sẻ dùng câu không số.
 * `enabled` false thì không gọi API (màn chỉ cần số lúc khách mở hộp chia sẻ, như sheet chia sẻ thương hiệu).
 */
export function useWelcomeOffer(enabled = true): WelcomeOffer | null {
  const q = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000, enabled });
  return welcomeOfferOf(q.data);
}
