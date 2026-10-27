'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getActiveFlashSales } from '@/lib/shop-client';
import type { FlashItem } from '@/lib/flash-price';

/**
 * Đợt Giờ vàng đang chạy, dùng chung cho mọi thẻ sản phẩm trên trang: một lần gọi API (không qua React Query để các test render
 * tĩnh và các trang không có provider vẫn chạy), làm mới mỗi phút khi còn thẻ đang xem. Lỗi/không phải mảng = không có đợt nào, tức
 * là hiện giá thường — giỏ và đơn vẫn tính đúng giá phía máy chủ.
 */
const REFRESH_MS = 60_000;
const NONE: readonly FlashItem[] = [];

let items: readonly FlashItem[] = NONE;
let loaded = false;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  inflight ??= getActiveFlashSales()
    .then((res) => {
      items = Array.isArray(res) ? res : NONE;
      fetchedAt = Date.now();
    })
    .catch(() => {
      items = NONE;
      fetchedAt = 0;
    })
    .finally(() => {
      loaded = true;
      inflight = null;
      listeners.forEach((l) => l());
    });
  return inflight;
}

function ensureFresh(): void {
  if (!inflight && Date.now() - fetchedAt >= REFRESH_MS) void load();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  timer ??= setInterval(ensureFresh, REFRESH_MS);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
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
  inflight = null;
}
