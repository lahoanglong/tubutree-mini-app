'use client';

import { createContext, createElement, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { makeFlashRefetchInterval } from '@tubutree/app-core/queries/flash-sale';
import { serverNow } from '@tubutree/app-core/server-clock';
import { getActiveFlashSales } from '@/lib/shop-client';
import type { FlashSaleActiveItem } from '@tubutree/app-core/api/flash-sale';
import { runningFlash, type FlashItem } from '@/lib/flash-price';

/**
 * Đợt Giờ vàng đang chạy, dùng chung cho mọi thẻ sản phẩm trên trang: một lần gọi API (không qua React Query để các test render
 * tĩnh và các trang không có provider vẫn chạy), làm mới khi còn thẻ đang xem (mỗi phút, và đúng mốc kết thúc đợt gần nhất nếu sớm hơn). Lỗi/không phải mảng = không có đợt nào, tức
 * là hiện giá thường — giỏ và đơn vẫn tính đúng giá phía máy chủ.
 */
const REFRESH_MS = 60_000;
const REUSE_MS = 10_000;
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
  // Nhịp hỏi lại của khối Trang chủ và nhịp của kho này không trùng nhau: dữ liệu vừa tải dưới ngần này giây thì dùng lại.
  if (!inflight && !failure && fetchedAt > 0 && Date.now() - fetchedAt < REUSE_MS) return [...items] as unknown as FlashSaleActiveItem[];
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

/**
 * Danh sách Giờ vàng do server tải sẵn cho trang ISR (trang sản phẩm) cùng giờ lúc server dựng HTML (`now`): lần dựng đầu (HTML server và hydrate) đã biết
 * giá/thanh Giờ vàng nên không chèn thanh Giờ vàng hay đổi dòng giá sau hydrate. Nằm trong context (không ghi vào kho dùng chung) vì kho là biến của
 * tiến trình server, dùng chung giữa mọi yêu cầu và mọi trang.
 */
const ServerSeed = createContext<{ items: readonly FlashItem[]; now: number } | null>(null);

const subscribeNever = () => () => undefined;

/**
 * Ở trình duyệt gieo mảng này vào kho dùng chung (cùng mảng với context, nên React không thấy snapshot đổi sau hydrate) để khối khác của trang đọc cùng
 * dữ liệu, nhưng KHÔNG đánh dấu `loaded`: bản ISR có thể cũ tới 5 phút, nên những việc chờ "danh sách thật đã về" (chọn phân loại mở sẵn) vẫn chờ lần hỏi
 * đầu tiên của trình duyệt. `fetchedAt` giữ 0 để effect của `useActiveFlashSales` hỏi lại ngay.
 */
export function FlashSalesSeed({ items: seed, now, children }: { items: readonly FlashItem[] | undefined; now: number; children: ReactNode }) {
  if (typeof window !== 'undefined' && seed && !loaded && items === NONE) items = seed;
  return createElement(ServerSeed.Provider, { value: seed ? { items: seed, now } : null }, children);
}

export function useActiveFlashSales(): readonly FlashItem[] {
  const seed = useContext(ServerSeed);
  const current = useSyncExternalStore(subscribe, () => items, () => seed?.items ?? NONE);
  useEffect(() => {
    ensureFresh();
  }, []);
  return current;
}

/**
 * Đợt đang chạy cho trang sản phẩm, cùng `now` để mọi chỗ lọc/tính giá khớp nhau. Lần dựng hydrate dùng giờ server lúc dựng HTML (đợt hết giữa lúc dựng và lúc tải vẫn
 * hiện như HTML, không lệch hydrate); ngay sau đó chuyển sang giờ máy chủ đã đồng bộ, đợt đã hết thì biến mất một lần. Trang không có gieo sẵn luôn dùng giờ đồng bộ.
 */
export function useRunningFlash(): { flash: FlashItem[]; now: number } {
  const seed = useContext(ServerSeed);
  const list = useActiveFlashSales();
  const settled = useSyncExternalStore(subscribeNever, () => true, () => false);
  const now = seed && !settled ? seed.now : serverNow();
  return { flash: runningFlash(list, now), now };
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
