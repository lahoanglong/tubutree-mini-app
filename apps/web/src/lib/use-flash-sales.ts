'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { makeFlashRefetchInterval } from '@tubutree/app-core/queries/flash-sale';
import { serverNow } from '@tubutree/app-core/server-clock';
import { getActiveFlashSales } from '@/lib/shop-client';
import type { FlashSaleActiveItem } from '@tubutree/app-core/api/flash-sale';
import type { FlashItem } from '@/lib/flash-price';

/**
 * Đợt Giờ vàng đang chạy, dùng chung cho mọi thẻ sản phẩm trên trang: một lần gọi API (không qua React Query để các test render
 * tĩnh và các trang không có provider vẫn chạy), làm mới khi còn thẻ đang xem (mỗi phút, và đúng mốc kết thúc đợt gần nhất nếu sớm hơn). Lỗi/không phải mảng = không có đợt nào, tức
 * là hiện giá thường — giỏ và đơn vẫn tính đúng giá phía máy chủ.
 */
const REFRESH_MS = 60_000;
const NONE: readonly FlashItem[] = [];

let items: readonly FlashItem[] = NONE;
let loaded = false;
let fetchedAt = 0;
let failure: unknown = null;
let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  inflight ??= getActiveFlashSales()
    .then((res) => {
      items = Array.isArray(res) ? res : NONE;
      fetchedAt = Date.now();
      failure = null;
    })
    .catch((err: unknown) => {
      items = NONE;
      fetchedAt = 0;
      failure = err ?? new Error('flash-sales');
    })
    .finally(() => {
      loaded = true;
      inflight = null;
      listeners.forEach((l) => l());
      reschedule();
    });
  return inflight;
}

/**
 * Cùng một lần tải cho khối Giờ vàng ở Trang chủ (React Query) và các thẻ sản phẩm (kho này): nhờ vậy `/flash-sales/active` chỉ bị gọi một lần.
 * Lỗi được ném lại để khối Trang chủ giữ trạng thái lỗi riêng.
 */
export async function loadActiveFlashSales(): Promise<FlashSaleActiveItem[]> {
  void load();
  await inflight;
  if (failure) throw failure;
  // API trả cả tên và ảnh sản phẩm; FlashItem của thẻ sản phẩm chỉ giữ phần giá.
  return [...items] as unknown as FlashSaleActiveItem[];
}

function ensureFresh(): void {
  if (!inflight && Date.now() - fetchedAt >= REFRESH_MS) void load();
}

/**
 * Lần tải kế: đúng mốc kết thúc gần nhất (5 đến 60 giây, cùng quy tắc `makeFlashRefetchInterval` của Mini App) để thẻ bỏ giá Giờ vàng
 * ngay khi đợt hết; không có suất nào thì nhịp 60 giây để thấy đợt mới bắt đầu.
 */
function nextDelay(): number {
  const ms = makeFlashRefetchInterval(serverNow)({ state: { data: items } });
  return ms === false ? REFRESH_MS : ms;
}

function reschedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (listeners.size === 0) return;
  timer = setTimeout(() => {
    timer = null;
    void load();
  }, nextDelay());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!timer) reschedule();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export function useActiveFlashSales(): readonly FlashItem[] {
  const current = useSyncExternalStore(subscribe, () => items, () => NONE);
  useEffect(() => {
    ensureFresh();
  }, []);
  return current;
}

/** Đã có kết quả đầu tiên (kể cả lỗi): trang chi tiết chờ cờ này rồi mới chốt phân loại mặc định. */
export function useFlashSalesLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loaded, () => false);
}

/** Chỉ cho test: xoá bộ nhớ dùng chung giữa các ca. */
export function resetFlashSales(): void {
  loaded = false;
  items = NONE;
  fetchedAt = 0;
  failure = null;
  inflight = null;
}
