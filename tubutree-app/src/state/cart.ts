/**
 * Cart State — Quản lý giỏ hàng
 */
import { atom, selector } from 'recoil';
import type { CartItem } from 'types';

export const cartItemsState = atom<CartItem[]>({
  key: 'cartItemsState',
  default: [],
});

export const cartCountState = selector<number>({
  key: 'cartCountState',
  get: ({ get }) => {
    const items = get(cartItemsState);
    return items.reduce((sum, item) => sum + item.qty, 0);
  },
});
