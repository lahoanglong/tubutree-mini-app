'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { coreHttp } from '../core-http';
import { usePublicConfig } from '../use-public-config';

/** Thời gian tối đa chờ cấu hình công khai khi khách bấm mua lúc nó chưa về: quá hạn thì giữ hành vi cũ (sang đăng nhập). */
export const GUEST_CART_FLAG_WAIT_MS = 1_500;

/** Chỉ đúng boolean `true` từ máy chủ mới bật; API cũ không trả trường thì tắt. */
export function guestCartOn(cfg: Pick<PublicConfig, 'webGuestCartEnabled'> | null | undefined): boolean {
  return cfg?.webGuestCartEnabled === true;
}

/**
 * Cờ `web.guest_cart_enabled` cho màn đang vẽ. `pending` khi cấu hình đang tải lần đầu: trang giỏ chờ thay vì chớp tường đăng nhập rồi đổi
 * sang giỏ khách. Cấu hình lỗi thì coi như tắt (hành vi cũ).
 */
export function useGuestCartFlag(opts?: { enabled?: boolean }): { enabled: boolean; pending: boolean } {
  const cfg = usePublicConfig(undefined, opts);
  return { enabled: cfg.isLoaded && guestCartOn(cfg), pending: cfg.isPending };
}

/** Đọc cờ lúc khách bấm: lấy bản đã có trong bộ nhớ đệm, chưa có thì hỏi máy chủ nhưng chờ không quá `GUEST_CART_FLAG_WAIT_MS`. */
export async function guestCartFlagNow(qc: QueryClient, waitMs: number = GUEST_CART_FLAG_WAIT_MS): Promise<boolean> {
  const cached = qc.getQueryData<PublicConfig>(publicConfigQuery(coreHttp).queryKey);
  if (cached) return guestCartOn(cached);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  try {
    const cfg = await Promise.race([qc.ensureQueryData({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000 }), timeout]);
    return guestCartOn(cfg);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
