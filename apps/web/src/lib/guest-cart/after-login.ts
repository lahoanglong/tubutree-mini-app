'use client';

import type { QueryClient } from '@tanstack/react-query';
import { addToCart, getCart, getProductStock } from '../shop-client';
import { rememberReturnTo } from '../return-to';
import { settleWithin } from '../settle-within';
import { guestCartFlagNow } from './flag';
import { mergeGuestCart, type GuestMergeResult } from './merge';
import { readGuestCart } from './store';

/** Lời báo cho trang giỏ sau khi gộp: món nào không thêm được hay bị giảm số lượng. Sống trong tab, đọc một lần. */
export const GUEST_MERGE_NOTE_KEY = 'tubu.guestCart.mergeNote';
const NOTE_TTL_MS = 10 * 60_000;
/** Chờ gộp tối đa chừng này trước khi rời trang callback; quá hạn thì gộp chạy tiếp và giỏ tự tải lại khi xong. */
export const GUEST_MERGE_WAIT_MS = 8_000;

export interface GuestMergeNote {
  failedLines: number;
  reduced: number;
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function saveNote(r: GuestMergeResult, now: number): void {
  if (r.failedLines === 0 && r.reduced === 0) return;
  try {
    session()?.setItem(GUEST_MERGE_NOTE_KEY, JSON.stringify({ failedLines: r.failedLines, reduced: r.reduced, at: now }));
  } catch {
    /* không có bộ nhớ thì trang giỏ không báo, giỏ máy chủ vẫn đúng */
  }
}

/** Đọc rồi xoá lời báo gộp giỏ; quá hạn hay hỏng thì null. */
export function takeGuestMergeNote(now: number = Date.now()): GuestMergeNote | null {
  const s = session();
  if (!s) return null;
  try {
    const raw = s.getItem(GUEST_MERGE_NOTE_KEY);
    if (raw === null) return null;
    s.removeItem(GUEST_MERGE_NOTE_KEY);
    const v = JSON.parse(raw) as Partial<GuestMergeNote> & { at?: unknown };
    if (typeof v.at !== 'number' || now - v.at > NOTE_TTL_MS || now < v.at) return null;
    const failedLines = Number.isInteger(v.failedLines) && (v.failedLines as number) > 0 ? (v.failedLines as number) : 0;
    const reduced = Number.isInteger(v.reduced) && (v.reduced as number) > 0 ? (v.reduced as number) : 0;
    return failedLines + reduced > 0 ? { failedLines, reduced } : null;
  } catch {
    return null;
  }
}

/**
 * Gọi ngay sau khi đăng nhập (đã có access token): giỏ khách còn món và cờ `web.guest_cart_enabled` bật thì gộp vào giỏ máy chủ, rồi đăng
 * nhập xong quay về `/gio-hang` để khách thấy đủ món. Cờ tắt thì không đụng giỏ khách (để nguyên cho lần bật lại). Không bao giờ ném:
 * gộp hỏng không được chặn đăng nhập.
 */
export async function mergeGuestCartAfterLogin(qc: QueryClient, waitMs: number = GUEST_MERGE_WAIT_MS): Promise<void> {
  try {
    if (readGuestCart().length === 0) return;
    if (!(await guestCartFlagNow(qc))) return;
    const work = mergeGuestCart({ getCart, addToCart, getStock: getProductStock }).then((r) => {
      if (!r) return;
      saveNote(r, Date.now());
      void qc.invalidateQueries({ queryKey: ['cart'] });
    });
    rememberReturnTo('/gio-hang');
    await settleWithin(work, waitMs);
  } catch {
    /* gộp là việc phụ của đăng nhập */
  }
}
