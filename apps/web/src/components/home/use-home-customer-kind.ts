'use client';

import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { PurchasedItemsPage } from '@tubutree/app-core/api/orders';
import { HOME_KIND_KEY, readLastTodoRows } from '@tubutree/app-core/home-layout';
import { hasSessionMarker, writeWebCookie } from '@/lib/client-api';
import { HOME_HINT_COOKIE, hintSlug } from '@/lib/home-restore-hint';
import { HomeRestoreHintContext, subscribeStorageEvent } from '@/lib/home-restore-context';
import { browserStorage } from '@/lib/recently-viewed';
import { customerKind, resolveHomeKind, type HomeCustomerKind, type HomeKindState } from './home-blocks';

export { HOME_KIND_KEY };

/** Giá trị lưu: `{ userId, kind }` của khách đăng nhập gần nhất. Sai dạng / khác tài khoản → bỏ qua. */
export function readStoredHomeKind(userId: string | null | undefined): HomeCustomerKind | null {
  if (!userId) return null;
  try {
    const raw = browserStorage()?.getItem(HOME_KIND_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const r = v as Record<string, unknown>;
    if (r.userId !== userId) return null;
    return r.kind === 'new' || r.kind === 'returning' ? r.kind : null;
  } catch {
    return null;
  }
}

/** Loại của tài khoản dùng gần nhất trên máy, bất kể là ai: chỉ dùng trong lúc khôi phục phiên, khi chưa biết đang là tài khoản nào. */
export function readLastStoredHomeKind(): HomeCustomerKind | null {
  try {
    const raw = browserStorage()?.getItem(HOME_KIND_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { kind?: unknown } | null;
    return v?.kind === 'new' || v?.kind === 'returning' ? v.kind : null;
  } catch {
    return null;
  }
}

/**
 * Ghi cookie gợi ý bố cục (loại khách + số dòng Việc cần làm đã nhớ) để lần mở sau server dựng sẵn đúng khung chờ. Chỉ khi đang có phiên
 * (cờ phiên còn), vì cookie này vô nghĩa với khách vãng lai và bị xoá cùng cờ phiên khi đăng xuất.
 */
export function syncHomeHintCookie(): void {
  if (!hasSessionMarker()) return;
  const rows = readLastTodoRows(browserStorage());
  writeWebCookie(HOME_HINT_COOKIE, hintSlug({ kind: readLastStoredHomeKind() ?? 'unknown', rows: rows === 1 || rows === 2 ? rows : 0 }));
}

function writeStoredHomeKind(userId: string, kind: HomeCustomerKind): void {
  try {
    browserStorage()?.setItem(HOME_KIND_KEY, JSON.stringify({ userId, kind }));
  } catch {
    /* hết quota / bị chặn — chỉ mất việc đoán trước thứ tự khối ở lần mở sau */
  }
  syncHomeHintCookie();
}


/**
 * Khách cũ hay mới để chọn thứ tự khối Trang chủ.
 * Trong lúc `purchased-items` còn tải, dùng loại đã nhớ lần trước của CHÍNH tài khoản này (nếu có) để khách cũ
 * thấy đúng thứ tự ngay từ khung hình đầu — nếu không, "Dành cho bạn" nhảy từ khối 7 lên khối 5 lúc dữ liệu về
 * và đẩy "Bán chạy" xuống cả một khối lưới. Truy vấn xong → loại thật, được ghi lại cho lần mở sau.
 * Khách chưa đăng nhập luôn là "new", không đọc/ghi gì; đang khôi phục phiên thì không bao giờ là "new". Lỗi tải: vẫn giữ loại đã nhớ (khách cũ không bị đẩy về bố cục khách mới
 * vì một lần API chập chờn) và không ghi đè giá trị đã nhớ. Chưa nhớ gì và đang tải: "unknown" (xem `resolveHomeKind`).
 */
export function useHomeCustomerKind(
  authed: boolean,
  userId: string | null | undefined,
  purchased: Pick<UseQueryResult<PurchasedItemsPage>, 'isPending' | 'isSuccess' | 'data'>,
  /** Đang khôi phục phiên: chưa biết là ai nên dùng loại của tài khoản dùng gần nhất, chưa nhớ thì "unknown". */
  authPending = false,
): HomeKindState {
  // Loại nhớ của tài khoản dùng gần nhất: đọc bằng useSyncExternalStore để lần hydrate đầu dùng gợi ý của bản server (không lệch HTML), sau đó mới đọc localStorage.
  const prebuilt = useContext(HomeRestoreHintContext);
  const lastKind = useSyncExternalStore(subscribeStorageEvent, () => readLastStoredHomeKind() ?? '', () => (prebuilt && prebuilt.kind !== 'unknown' ? prebuilt.kind : ''));
  const stored = useMemo(
    () => (authed ? readStoredHomeKind(userId) : authPending ? ((lastKind || null) as HomeCustomerKind | null) : null),
    [authed, authPending, userId, lastKind],
  );
  const settledKind = purchased.isSuccess ? customerKind(purchased.data?.items.length) : null;
  useEffect(() => {
    if (authed && userId && settledKind) writeStoredHomeKind(userId, settledKind);
  }, [authed, userId, settledKind]);

  return resolveHomeKind({ authed, authPending, stored, purchasedCount: purchased.data?.items.length, pending: purchased.isPending });
}
