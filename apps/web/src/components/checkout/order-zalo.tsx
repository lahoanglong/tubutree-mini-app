'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderZaloFriendFrom } from '@tubutree/shared-types';
import {
  enableOrderZaloForOrder,
  fetchOrderZaloStatus,
  orderZaloConsentView,
  orderZaloDetailView,
  orderZaloRecipientView,
  showOrderZaloFriend,
  tubuZaloNumber,
} from '@tubutree/app-core/order-zalo';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '@/lib/core-http';
import { useAuthPhase } from '@/lib/auth-phase';
import { usePublicConfig } from '@/lib/use-public-config';
import { trackWebEvent } from '@/lib/analytics';
import { actionErrorText } from '@/lib/error-text';
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

export type OrderZaloRecipientToggle = { buyerPhoneMasked: string; on: boolean; onChange: (v: boolean) => void };

/**
 * `checked` là giá trị gửi kèm đơn; undefined khi ô không hiện (máy chủ dùng lựa chọn đã nhớ). `address` là địa chỉ đang chọn: tài khoản chưa có
 * số thì ô dùng số nhận hàng (PO A2); số nhận hàng khác số tài khoản thì có thêm công tắc người nhận (PO A1), mặc định tắt, tự tắt lại khi khách
 * đổi địa chỉ hoặc bỏ tick ô đồng ý. `notifyRecipientZalo` là giá trị gửi kèm đơn. Cùng luật với Mini App.
 */
export function useOrderZaloConsent(address?: { id: string; phone?: string | null } | null) {
  const status = useOrderZaloStatus();
  const view = orderZaloConsentView(status, address?.phone);
  const [picked, setPickedState] = useState<boolean | null>(null);
  const [toggleOn, setToggleOn] = useState(false);
  const addressId = address?.id ?? null;
  const [toggleAddress, setToggleAddress] = useState(addressId);
  if (toggleAddress !== addressId) {
    setToggleAddress(addressId);
    setToggleOn(false);
  }
  const checked = view ? picked ?? view.checked : undefined;
  const recipientView = orderZaloRecipientView(status, address?.phone, checked === true);
  const notifyRecipientZalo = recipientView !== null && toggleOn;
  const setPicked = (v: boolean) => {
    setPickedState(v);
    if (!v) setToggleOn(false);
  };
  const recipient: OrderZaloRecipientToggle | undefined = recipientView ? { buyerPhoneMasked: recipientView.buyerPhoneMasked, on: notifyRecipientZalo, onChange: setToggleOn } : undefined;
  return { view, checked, setPicked, recipient, notifyRecipientZalo };
}

export function OrderZaloConsentRow({
  phone,
  checked,
  onChange,
  recipient,
}: {
  phone: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  recipient?: OrderZaloRecipientToggle;
}) {
  useEffect(() => {
    trackWebEvent('order_zalo_consent_shown', {});
  }, []);
  return (
    <>
      <ConsentLabel phone={phone} checked={checked} onChange={onChange} />
      {checked && recipient && <RecipientToggle recipient={recipient} />}
    </>
  );
}

/** Lời báo + công tắc người nhận: thụt theo chữ của ô đồng ý (ô 24px + khoảng 12px), công tắc là ô tick riêng đủ 44px. */
function RecipientToggle({ recipient }: { recipient: OrderZaloRecipientToggle }) {
  return (
    <div data-testid="order-zalo-recipient" className="pl-9 lg:pb-3">
      <p className="text-caption text-[color:var(--color-text-secondary)]">{fillCopy('checkout.orderZalo.recipientNote', { phone: recipient.buyerPhoneMasked })}</p>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <span className={miniCheckboxWrap}>
          <input type="checkbox" checked={recipient.on} onChange={(e) => recipient.onChange(e.target.checked)} className={miniCheckbox} />
          <CheckMark />
        </span>
        <span className="text-sm text-[color:var(--color-text-primary)]">{fillCopy('checkout.orderZalo.recipientToggle')}</span>
      </label>
    </div>
  );
}

function ConsentLabel({ phone, checked, onChange }: { phone: string; checked: boolean; onChange: (v: boolean) => void }) {
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

type OrderZaloDetailOrder = { code: string; status: string; orderZaloConsent?: unknown; orderZaloAvailable?: unknown; orderZaloOn?: unknown };

/**
 * Khối Zalo ở chi tiết đơn. Đơn chưa nhận tin hành trình (khách bỏ tick lúc đặt) mà máy chủ báo còn bật được thì có nút bật cho riêng đơn
 * này, đứng sau đúng câu đồng ý và số nhận của ô ở thanh toán (máy chủ ghi cùng phiên bản câu chữ): chỉ các sự kiện sau lúc bật mới được báo,
 * không gửi bù. Tin đang thật sự được gửi thì ghi số sẽ nhận tin, lối tắt sang Cài đặt và lời mời kết bạn. Cờ MSS tắt thì không hỏi máy chủ,
 * giữ đúng lời mời kết bạn như cũ. Cùng luật với Mini App (`components/checkout/order-zalo.tsx`).
 */
export function OrderZaloDetail({ order }: { order: OrderZaloDetailOrder }) {
  const enabled = usePublicConfig().orderZaloEnabled;
  const view = orderZaloDetailView(useOrderZaloStatus(), order);
  const qc = useQueryClient();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const enable = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNote(null);
    try {
      await enableOrderZaloForOrder(coreHttp, order.code);
      trackWebEvent('order_zalo_consent_from_detail', {});
      qc.setQueryData<OrderZaloDetailOrder>(['order', order.code], (o) => o && { ...o, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true });
      setNote({ ok: true, text: fillCopy('order.zaloDetail.done') });
    } catch (e) {
      setNote({ ok: false, text: actionErrorText(e) });
    } finally {
      await Promise.all([qc.invalidateQueries({ queryKey: ['order', order.code] }), qc.invalidateQueries({ queryKey: ORDER_ZALO_KEY })]);
      lock.current = false;
      setBusy(false);
    }
  };
  const status = note && (
    <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'sr-only' : `mt-2 ${ui.error}`}>
      {note.text}
    </p>
  );
  if (view?.kind === 'offer') {
    return (
      <div className="mt-3">
        <p className="mb-2 text-caption text-[color:var(--color-text-secondary)]">
          {fillCopy('checkout.orderZalo.body')} {fillCopy('checkout.orderZalo.phone', { phone: view.phone })}
        </p>
        <button type="button" className={`${ui.btnSecondary} w-full`} disabled={busy} aria-busy={busy || undefined} onClick={() => void enable()}>
          {fillCopy('order.zaloDetail.cta')}
        </button>
        {status}
      </div>
    );
  }
  if (!view && !showOrderZaloFriend(enabled, order)) return null;
  return (
    <div className="mt-3 flex flex-col items-start gap-2">
      {view && (
        <p data-testid="order-zalo-on" className="text-caption text-[color:var(--color-text-secondary)]">
          {fillCopy('order.zaloDetail.on', { phone: view.phone })}
          {' · '}
          <Link href="/tai-khoan/cai-dat" className="inline-flex min-h-11 items-center font-semibold text-[color:var(--color-text-brand)] underline">
            {fillCopy('order.zaloDetail.settings')}
          </Link>
        </p>
      )}
      {status}
      <OrderZaloFriend code={order.code} from="order_detail" />
    </div>
  );
}
