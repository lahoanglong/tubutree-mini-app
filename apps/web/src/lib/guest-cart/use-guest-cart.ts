'use client';

import { useSyncExternalStore } from 'react';
import { EMPTY_GUEST_CART, readGuestCart, subscribeGuestCart, type GuestCartLine } from './store';

const serverSnapshot = () => EMPTY_GUEST_CART;

/** Các dòng giỏ khách, vẽ lại khi giỏ đổi ở tab này hay tab khác. Máy chủ và lượt hydrate thấy giỏ trống (HTML không lệch). */
export function useGuestCartLines(): readonly GuestCartLine[] {
  return useSyncExternalStore(subscribeGuestCart, readGuestCart, serverSnapshot);
}
