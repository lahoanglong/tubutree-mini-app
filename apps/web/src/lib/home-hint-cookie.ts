import type { HomeCustomerKind } from '@tubutree/app-core/home-layout';
import { HOME_KIND_KEY, readLastTodoRows } from '@tubutree/app-core/home-layout';
import { hasSessionMarker, writeWebCookie } from '@/lib/client-api';
import { HOME_HINT_COOKIE, hintSlug } from '@/lib/home-restore-hint';
import { browserStorage } from '@/lib/recently-viewed';

// Module nhỏ không import React/context: trang thanh toán cần ghi cookie gợi ý mà không kéo mã hook Trang chủ vào bó của nó.
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
