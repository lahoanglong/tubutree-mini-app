'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrderZaloFriendFrom } from '@tubutree/shared-types';
import { fetchOrderZaloStatus, orderZaloConsentView, tubuZaloNumber } from '@tubutree/app-core/order-zalo';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '@/lib/core-http';
import { useAuthPhase } from '@/lib/auth-phase';
import { usePublicConfig } from '@/lib/use-public-config';
import { trackWebEvent } from '@/lib/analytics';
import { ui } from '@/lib/guest-ui';
import { CheckMark, miniCheckbox, miniCheckboxWrap } from '@/components/order-mobile/mobile-ui';

export const ORDER_ZALO_KEY = ['order-zalo'];

/**
 * Chỉ hỏi máy chủ khi cờ chung bật: cờ tắt thì màn không có request hay phần tử nào mới. Lỗi tải = không hiện ô, đơn vẫn đặt được.
 * Mỗi lần màn mở đều hỏi lại và chỉ dùng kết quả của lần hỏi đó: máy chủ ghi lựa chọn ngay trong giao dịch đặt hàng, bản cache của đơn trước
 * sẽ tick sẵn (hoặc bỏ tick) theo lựa chọn cũ rồi gửi đè lên lựa chọn khách vừa đổi.
 */
export function useOrderZaloStatus() {
  const authed = useAuthPhase() === 'authenticated';
  // Cùng khoá cache với `usePublicConfig` nhưng chỉ tải khi đã đăng nhập: màn chưa đăng nhập không gọi API nào.
  const flag = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000, enabled: authed }).data?.orderZaloEnabled === true;
  const q = useQuery({ queryKey: ORDER_ZALO_KEY, queryFn: () => fetchOrderZaloStatus(coreHttp), enabled: flag && authed, refetchOnMount: 'always', retry: false });
  return q.isFetchedAfterMount && !q.isError ? q.data : undefined;
}

/** `checked` là giá trị gửi kèm đơn; undefined khi ô không hiện (máy chủ dùng lựa chọn đã nhớ). */
export function useOrderZaloConsent() {
  const view = orderZaloConsentView(useOrderZaloStatus());
  const [picked, setPicked] = useState<boolean | null>(null);
  return { view, checked: view ? picked ?? view.checked : undefined, setPicked };
}

export function OrderZaloConsentRow({ phone, checked, onChange }: { phone: string; checked: boolean; onChange: (v: boolean) => void }) {
  useEffect(() => {
    trackWebEvent('order_zalo_consent_shown', {});
  }, []);
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 pt-3 lg:pb-3 lg:pt-0">
      <span className={miniCheckboxWrap}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            onChange(e.target.checked);
            trackWebEvent('order_zalo_consent_checked', { checked: e.target.checked });
          }}
          className={miniCheckbox}
        />
        <CheckMark />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[color:var(--color-text-primary)]">{fillCopy('checkout.orderZalo.label')}</span>
        <span className="block text-caption text-[color:var(--color-text-secondary)]">
          {fillCopy('checkout.orderZalo.body')} {fillCopy('checkout.orderZalo.phone', { phone })}
        </span>
      </span>
    </label>
  );
}

/** Lời mời kết bạn Zalo Tubu Tree: liên kết phụ mở zalo.me ở thẻ mới, không tranh vai nút chính của màn. */
export function OrderZaloFriend({ code, from }: { code: string; from: OrderZaloFriendFrom }) {
  const phone = tubuZaloNumber(usePublicConfig().tubuZaloPhone);
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-[color:var(--color-text-primary)]">{fillCopy('order.zaloFriend.body', { code })}</p>
      <a
        href={`https://zalo.me/${phone}`}
        target="_blank"
        rel="noopener"
        className={ui.btnSecondary}
        onClick={() => trackWebEvent('order_zalo_friend_click', { from })}
      >
        {fillCopy('order.zaloFriend.cta')}
      </a>
    </div>
  );
}
