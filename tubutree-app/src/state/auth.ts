/**
 * Auth State — Quản lý trạng thái đăng nhập
 */
import { atom } from 'recoil';
import type { User } from 'types';

export const userState = atom<User | null>({
  key: 'userState',
  default: null,
});

export const tokenState = atom<string | null>({
  key: 'tokenState',
  default: localStorage.getItem('tubutree_token'),
});

export const isLoggedInState = atom<boolean>({
  key: 'isLoggedInState',
  default: !!localStorage.getItem('tubutree_token'),
});
