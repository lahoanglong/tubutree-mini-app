'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { claimGuestOrdersRequest } from './api';
import { clearGuestClaimPending, existingGuestDeviceId, guestClaimPending } from './keys';

let inflight: Promise<number> | null = null;

/**
 * Đưa đơn đặt không đăng nhập của trình duyệt này về tài khoản Zalo vừa đăng nhập (POST /checkout/guest/claim, máy chủ gộp tài khoản vãng lai
 * bằng `mergeGuestInto`, đúng một lần). Chỉ gọi khi trình duyệt có đơn đặt không đăng nhập chưa đưa về; lỗi mạng thì giữ dấu để lần sau gọi lại.
 */
export function claimGuestOrdersOnce(): Promise<number> {
  if (!guestClaimPending()) return Promise.resolve(0);
  const device = existingGuestDeviceId();
  if (!device) {
    clearGuestClaimPending();
    return Promise.resolve(0);
  }
  inflight ??= claimGuestOrdersRequest(device)
    .then((r) => {
      clearGuestClaimPending();
      return r?.claimed ?? 0;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Gọi `claimGuestOrdersOnce` khi phiên đã đăng nhập; trả số đơn vừa đưa về (null khi chưa xong hoặc không có gì). */
export function useGuestOrderClaim(authenticated: boolean): number | null {
  const qc = useQueryClient();
  const [claimed, setClaimed] = useState<number | null>(null);
  useEffect(() => {
    if (!authenticated || !guestClaimPending()) return;
    let alive = true;
    claimGuestOrdersOnce()
      .then((n) => {
        if (n > 0) void qc.invalidateQueries({ queryKey: ['orders'] });
        if (alive && n > 0) setClaimed(n);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [authenticated, qc]);
  return claimed;
}
