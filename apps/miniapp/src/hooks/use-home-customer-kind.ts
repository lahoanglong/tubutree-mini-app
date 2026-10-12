import { useEffect, useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { customerKind, type HomeCustomerKind } from '../components/home/home-blocks';
import type { PurchasedItemsPage } from '../services/shop-api';
import { browserStorage } from '../utils/recently-viewed';

export const HOME_KIND_KEY = 'tubu_home_kind';

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

function writeStoredHomeKind(userId: string, kind: HomeCustomerKind): void {
  try {
    browserStorage()?.setItem(HOME_KIND_KEY, JSON.stringify({ userId, kind }));
  } catch {
    /* hết quota / bị chặn — chỉ mất việc đoán trước thứ tự khối ở lần mở sau */
  }
}

/**
 * Khách cũ hay mới để chọn thứ tự khối Trang chủ.
 * Trong lúc `purchased-items` còn tải, dùng loại đã nhớ lần trước của CHÍNH tài khoản này (nếu có) để khách cũ
 * thấy đúng thứ tự ngay từ khung hình đầu — nếu không, "Dành cho bạn" nhảy từ khối 7 lên khối 5 lúc dữ liệu về
 * và đẩy "Bán chạy" xuống cả một khối lưới. Truy vấn xong → loại thật, được ghi lại cho lần mở sau.
 * Khách chưa đăng nhập luôn là "new", không đọc/ghi gì. Lỗi (vd API cũ 404) → "new", không ghi đè giá trị đã nhớ.
 */
export function useHomeCustomerKind(
  authed: boolean,
  userId: string | null | undefined,
  purchased: Pick<UseQueryResult<PurchasedItemsPage>, 'isPending' | 'isSuccess' | 'data'>,
): HomeCustomerKind {
  const stored = useMemo(() => (authed ? readStoredHomeKind(userId) : null), [authed, userId]);
  const settledKind = purchased.isSuccess ? customerKind(purchased.data?.items.length) : null;
  useEffect(() => {
    if (authed && userId && settledKind) writeStoredHomeKind(userId, settledKind);
  }, [authed, userId, settledKind]);

  if (!authed) return 'new';
  if (settledKind) return settledKind;
  return purchased.isPending ? (stored ?? 'new') : 'new';
}
