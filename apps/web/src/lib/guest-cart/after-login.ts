'use client';

import type { QueryClient } from '@tanstack/react-query';
import { addToCart, getCart, getProductStock } from '../shop-client';
import { rememberReturnTo, takeReturnTo } from '../return-to';
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
  kept: number;
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function saveNote(r: GuestMergeResult, now: number): void {
  if (r.failedLines === 0 && r.reduced === 0 && r.kept === 0) return;
  try {
    session()?.setItem(GUEST_MERGE_NOTE_KEY, JSON.stringify({ failedLines: r.failedLines, reduced: r.reduced, kept: r.kept, at: now }));
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
    const count = (n: unknown) => (Number.isInteger(n) && (n as number) > 0 ? (n as number) : 0);
    const note = { failedLines: count(v.failedLines), reduced: count(v.reduced), kept: count(v.kept) };
    return note.failedLines + note.reduced + note.kept > 0 ? note : null;
  } catch {
    return null;
  }
}

/** Gộp giỏ khách vào giỏ tài khoản (phiên đã đăng nhập), ghi lời báo cho trang giỏ và tải lại giỏ. Dùng chung cho callback và trang giỏ. */
export function runGuestMerge(qc: QueryClient): Promise<GuestMergeResult | null> {
  return mergeGuestCart({ getCart, addToCart, getStock: getProductStock }).then((r) => {
    if (r) {
      saveNote(r, Date.now());
      void qc.invalidateQueries({ queryKey: ['cart'] });
    }
    return r;
  });
}

/**
 * Đăng nhập từ Trang chủ hay từ chính giỏ thì đăng nhập xong về giỏ để khách thấy món đã chuyển sang. Đăng nhập để làm việc khác (nhận mã,
 * xem đơn, mua món ở trang sản phẩm) thì giữ nguyên nơi quay lại.
 */
function preferCartReturn(): void {
  const prev = takeReturnTo();
  rememberReturnTo(prev === null || prev === '/' || prev === '/gio-hang' ? '/gio-hang' : prev);
}

/**
 * Gọi ngay sau khi đăng nhập (đã có access token): giỏ khách còn món và cờ `web.guest_cart_enabled` bật thì gộp vào giỏ máy chủ. Chờ tối
 * đa `waitMs` cho cả cờ lẫn gộp: trang callback là lần tải mới nên cấu hình chưa có sẵn, mà giỏ khách còn món đã là dấu hiệu cờ bật, nên
 * không bỏ cuộc sau 1,5 giây như lúc bấm mua. Quá hạn thì gộp chạy tiếp ở nền; dòng chưa gộp được thì trang giỏ gộp lại khi mở.
 * Cờ tắt thì không đụng giỏ khách. Không bao giờ ném: gộp hỏng không được chặn đăng nhập.
 */
export async function mergeGuestCartAfterLogin(qc: QueryClient, waitMs: number = GUEST_MERGE_WAIT_MS): Promise<void> {
  try {
    if (readGuestCart().length === 0) return;
    let left = false;
    const work = (async () => {
      if (!(await guestCartFlagNow(qc, waitMs))) return;
      // Callback đã rời đi thì nơi quay lại đã được dùng: ghi lúc này chỉ để lại giá trị sót cho lần đăng nhập sau.
      if (!left) preferCartReturn();
      await runGuestMerge(qc);
    })().catch(() => undefined);
    await settleWithin(work, waitMs);
    left = true;
  } catch {
    /* gộp là việc phụ của đăng nhập */
  }
}
