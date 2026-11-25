import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { openWebview } from 'zmp-sdk/apis';
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
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '../../services/core-http';
import { trackEvent } from '../../services/analytics';
import { getErrorMessage } from '../../services/api';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useNotify } from '../../hooks/use-notify';
import { copyText } from '../../utils/clipboard';
import { Checkbox } from '../ui/form';
import { rowKeyboardProps } from '../ui/row-keyboard';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

export const ORDER_ZALO_KEY = ['order-zalo'];

/**
 * Chỉ hỏi máy chủ khi cờ chung bật: cờ tắt thì màn không có request hay phần tử nào mới. Lỗi tải = không hiện ô, đơn vẫn đặt được.
 * Mỗi lần màn mở đều hỏi lại và chỉ dùng kết quả của lần hỏi đó: máy chủ ghi lựa chọn ngay trong giao dịch đặt hàng, bản cache của đơn trước
 * sẽ tick sẵn (hoặc bỏ tick) theo lựa chọn cũ rồi gửi đè lên lựa chọn khách vừa đổi.
 */
export function useOrderZaloStatus() {
  const q = useQuery({ queryKey: ORDER_ZALO_KEY, queryFn: () => fetchOrderZaloStatus(coreHttp), enabled: usePublicConfig().orderZaloEnabled === true, refetchOnMount: 'always', retry: false });
  return q.isFetchedAfterMount && !q.isError ? q.data : undefined;
}

export type OrderZaloRecipientToggle = { buyerPhoneMasked: string; on: boolean; onChange: (v: boolean) => void };

/**
 * `checked` là giá trị gửi kèm đơn; undefined khi ô không hiện (máy chủ dùng lựa chọn đã nhớ). `address` là địa chỉ đang chọn: tài khoản chưa có
 * số thì ô dùng số nhận hàng (PO A2); số nhận hàng khác số tài khoản thì có thêm công tắc người nhận (PO A1), mặc định tắt, tự tắt lại khi khách
 * đổi địa chỉ hoặc bỏ tick ô đồng ý. `notifyRecipientZalo` là giá trị gửi kèm đơn. Cùng luật với web.
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

const ROW = { display: 'flex', gap: 'var(--space-inline-md)', alignItems: 'flex-start' } as const;

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
  useEffect(() => void trackEvent('order_zalo_consent_shown', 'miniapp', {}), []);
  const toggle = () => {
    onChange(!checked);
    void trackEvent('order_zalo_consent_checked', 'miniapp', { checked: !checked });
  };
  return (
    <>
      <div role="checkbox" aria-checked={checked} {...rowKeyboardProps()} onClick={toggle} style={{ ...ROW, padding: 'var(--space-inset-card) var(--space-gutter) 0' }}>
        <Checkbox checked={checked} onChange={() => {}} flush />
        <div>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
            {fillCopy('checkout.orderZalo.label')}
          </Text>
          <Text variant="caption" tone="secondary" as="div">
            {fillCopy('checkout.orderZalo.body')} {fillCopy('checkout.orderZalo.phone', { phone })}
          </Text>
        </div>
      </div>
      {checked && recipient && <RecipientToggle recipient={recipient} />}
    </>
  );
}

/** Lời báo + công tắc người nhận dưới ô đồng ý, thụt theo chữ của ô (ô tick rộng bằng --space-stack-lg, cộng khoảng cách hàng); công tắc là một hàng chạm riêng. */
function RecipientToggle({ recipient }: { recipient: OrderZaloRecipientToggle }) {
  return (
    <div data-testid="order-zalo-recipient" style={{ padding: '0 var(--space-gutter) 0 calc(var(--space-gutter) + var(--space-stack-lg) + var(--space-inline-md))' }}>
      <Text variant="caption" tone="secondary" as="p">
        {fillCopy('checkout.orderZalo.recipientNote', { phone: recipient.buyerPhoneMasked })}
      </Text>
      <div role="checkbox" aria-checked={recipient.on} {...rowKeyboardProps()} onClick={() => recipient.onChange(!recipient.on)} className="touch-target" style={{ ...ROW, alignItems: 'center', justifyContent: 'flex-start' }}>
        <Checkbox checked={recipient.on} onChange={() => {}} flush />
        <Text variant="body-sm" as="div">
          {fillCopy('checkout.orderZalo.recipientToggle')}
        </Text>
      </div>
    </div>
  );
}

/** Lời mời kết bạn Zalo Tubu Tree. Webview Zalo có thể chặn mở liên kết: khi đó hiện số để khách tự tìm, kèm nút chép. */
export function OrderZaloFriend({ code, from }: { code: string; from: OrderZaloFriendFrom }) {
  const phone = tubuZaloNumber(usePublicConfig().tubuZaloPhone);
  const [blocked, setBlocked] = useState(false);
  const { notify } = useNotify();
  const press = () => {
    if (blocked) return void copyText(phone).then((ok) => ok && notify({ text: fillCopy('order.zaloFriend.copied'), type: 'success' }));
    void trackEvent('order_zalo_friend_click', 'miniapp', { from });
    openWebview({ url: `https://zalo.me/${phone}` }).catch(() => setBlocked(true));
  };
  return (
    <div>
      <Text variant="body-sm" as="p" style={{ marginBottom: 'var(--space-stack-sm)' }}>
        {fillCopy(blocked ? 'order.zaloFriend.blocked' : 'order.zaloFriend.body', { code, phone })}
      </Text>
      <Button variant="secondary" onPress={press}>
        {fillCopy(blocked ? 'order.zaloFriend.copy' : 'order.zaloFriend.cta')}
      </Button>
    </div>
  );
}

type OrderZaloDetailOrder = { code: string; status: string; orderZaloConsent?: unknown; orderZaloAvailable?: unknown; orderZaloOn?: unknown };

/**
 * Khối Zalo ở chi tiết đơn. Đơn chưa nhận tin hành trình (khách bỏ tick lúc đặt) mà máy chủ báo còn bật được thì có nút bật cho riêng đơn
 * này, đứng sau đúng câu đồng ý và số nhận của ô ở thanh toán (máy chủ ghi cùng phiên bản câu chữ): chỉ các sự kiện sau lúc bật mới được báo,
 * không gửi bù. Tin đang thật sự được gửi thì ghi số sẽ nhận tin, lối tắt sang Cài đặt và lời mời kết bạn. Cờ MSS tắt thì không hỏi máy chủ,
 * giữ đúng lời mời kết bạn như cũ.
 */
export function OrderZaloDetail({ order }: { order: OrderZaloDetailOrder }) {
  const enabled = usePublicConfig().orderZaloEnabled;
  const view = orderZaloDetailView(useOrderZaloStatus(), order);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { notify } = useNotify();
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    try {
      await enableOrderZaloForOrder(coreHttp, order.code);
      void trackEvent('order_zalo_consent_from_detail', 'miniapp', {});
      queryClient.setQueryData<OrderZaloDetailOrder>(['order', order.code], (o) => o && { ...o, orderZaloConsent: true, orderZaloAvailable: false, orderZaloOn: true });
      notify({ text: fillCopy('order.zaloDetail.done'), type: 'success' });
    } catch (e) {
      notify({ text: getErrorMessage(e), type: 'error' });
    } finally {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['order', order.code] }), queryClient.invalidateQueries({ queryKey: ORDER_ZALO_KEY })]);
      setBusy(false);
    }
  };
  if (view?.kind === 'offer') {
    return (
      <div style={GAP_TOP}>
        <Text variant="caption" tone="secondary" as="p" style={{ marginBottom: 'var(--space-stack-sm)' }}>
          {fillCopy('checkout.orderZalo.body')} {fillCopy('checkout.orderZalo.phone', { phone: view.phone })}
        </Text>
        <Button variant="secondary" fullWidth loading={busy} onPress={enable}>
          {fillCopy('order.zaloDetail.cta')}
        </Button>
      </div>
    );
  }
  if (!view && !showOrderZaloFriend(enabled, order)) return null;
  return (
    <div style={GAP_TOP}>
      {view && (
        <Text variant="caption" tone="secondary" as="p" data-testid="order-zalo-on">
          {fillCopy('order.zaloDetail.on', { phone: view.phone })}
          {' · '}
          <button type="button" className="tubu-press min-h-11" onClick={() => navigate('/settings')} style={INLINE_LINK}>
            {fillCopy('order.zaloDetail.settings')}
          </button>
        </Text>
      )}
      <OrderZaloFriend code={order.code} from="order_detail" />
    </div>
  );
}

const GAP_TOP = { marginTop: 'var(--space-stack-sm)' } as const;
const INLINE_LINK = {
  padding: 0,
  border: 0,
  background: 'none',
  font: 'inherit',
  fontWeight: 600,
  color: 'var(--color-text-brand)',
  textDecoration: 'underline',
} as const;
