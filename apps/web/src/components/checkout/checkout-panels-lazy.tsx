'use client';

import { useEffect, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import { preconnect } from 'react-dom';
import { Heading, Text } from '@/components/mini';
import { ui } from '@/lib/guest-ui';
import { orderDetailHref } from '@/lib/order-view';
import { loadCheckoutPanels, loadedCheckoutPanels, loadPanels, type CheckoutPanels } from './checkout-panels-load';

const t = {
  loading: 'Đang tải…',
  failed: 'Chưa tải được phần này. Kiểm tra mạng rồi bấm Thử lại.',
  retry: 'Thử lại',
  placed: 'Đơn hàng của bạn đã được ghi nhận',
  orderCode: 'Mã đơn hàng',
  trackOrder: 'Theo dõi đơn',
};

type Fallback<P> = (s: { failed: boolean; retry: () => void; props: P }) => ReactNode;

// Không dùng `next/dynamic` (React.lazy): khối đã tải sẵn vẫn treo một nhịp và React giữ chỗ chờ tới ~300 ms nên ô VAT, thẻ chuyển khoản
// nháy ra trễ; lần tải hỏng bị React nhớ mãi nên chỉ còn trang lỗi. Ở đây khối đã tải thì dựng ngay, hỏng thì hiện nút Thử lại.
function lazyPanel<P extends object>(pick: (m: CheckoutPanels) => ComponentType<P>, fallback: Fallback<P>) {
  function Panel(props: P) {
    const [mod, setMod] = useState(loadedCheckoutPanels);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
      if (mod) return undefined;
      let live = true;
      loadPanels().then(
        (m) => {
          if (live) setMod(m);
        },
        () => {
          if (live) setFailed(true);
        },
      );
      return () => {
        live = false;
      };
    }, [mod, attempt]);
    if (!mod) {
      const retry = () => {
        setFailed(false);
        setAttempt((n) => n + 1);
      };
      return fallback({ failed, retry, props });
    }
    const Component = pick(mod);
    return <Component {...props} />;
  }
  return Panel;
}

/**
 * Các khối của trang thanh toán chỉ cần sau một thao tác của khách, tách khỏi JS tải lần đầu của `/thanh-toan`: bốn ô hoá đơn VAT (tích ô),
 * thẻ tài khoản nhận chuyển khoản (chọn Chuyển khoản), form thêm/sửa địa chỉ (bấm Thêm/Sửa, hoặc sổ địa chỉ trống) và màn đặt thành công.
 * `preloadCheckoutPanels` (và giỏ, khi nút Thanh toán vào khung nhìn) tải sẵn chúng nên lần bấm đầu thường dựng ngay.
 */
export const InvoiceFieldsLazy = lazyPanel((m) => m.InvoiceFields, ({ failed, retry, props }) => failed && <PanelFailed onRetry={retry} className={props.className} />);
export const TransferPreviewLazy = lazyPanel((m) => m.TransferPreview, ({ failed, retry }) => failed && <PanelFailed onRetry={retry} />);
export const AddressFormLazy = lazyPanel((m) => m.AddressForm, ({ failed, retry }) => (failed ? <PanelFailed onRetry={retry} /> : <PanelLoading />));
export const OrderSuccessLazy = lazyPanel((m) => m.OrderSuccess, ({ failed, retry, props }) =>
  failed ? <OrderPlaced order={props.order} onRetry={retry} /> : <PanelLoading />,
);

/** Chỗ giữ khi chunk chưa về: một vùng status có chữ cho trình đọc màn hình, không aria-busy (globals.css ẩn chân trang theo aria-busy). */
function PanelLoading() {
  return (
    <div role="status" className="h-40 animate-pulse rounded-control bg-[var(--color-bg-subtle)] motion-reduce:animate-none">
      <span className="sr-only">{t.loading}</span>
    </div>
  );
}

function PanelFailed({ onRetry, className = '' }: { onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={`flex items-center justify-between gap-3 rounded-control bg-[var(--color-bg-subtle)] p-3 ${className}`}>
      <Text variant="body-sm">{t.failed}</Text>
      <button type="button" onClick={onRetry} className={ui.btnSecondary}>
        {t.retry}
      </button>
    </div>
  );
}

// Đơn ĐÃ tạo mà mạng chập đúng lúc tải màn đặt xong: vẫn báo đã ghi nhận kèm mã đơn và lối xem đơn, để khách không tưởng hỏng mà đặt lại.
function OrderPlaced({ order, onRetry }: { order: ComponentProps<CheckoutPanels['OrderSuccess']>['order']; onRetry: () => void }) {
  const codes = order.splitOrders && order.splitOrders.length > 1 ? order.splitOrders.map((o) => o.code) : [order.code];
  return (
    <section role="alert" className="mx-auto flex max-w-md flex-col gap-3 px-4 py-8 text-center">
      <Heading variant="title-sm" as="h1">
        {t.placed}
      </Heading>
      <Text variant="body-sm" as="p">
        {t.orderCode}: <strong className="tabular-nums">{codes.join(', ')}</strong>
      </Text>
      <Text variant="caption" tone="secondary" as="p">
        {t.failed}
      </Text>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href={orderDetailHref(order.code)} replace className={ui.btnPrimary}>
          {t.trackOrder}
        </Link>
        <button type="button" onClick={onRetry} className={ui.btnSecondary}>
          {t.retry}
        </button>
      </div>
    </section>
  );
}

/** Tải sẵn chunk các khối trên lúc trình duyệt rảnh. Trả hàm huỷ cho `useEffect`. */
export function preloadCheckoutPanels(): () => void {
  const run = () => void loadCheckoutPanels();
  const w = window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: 3000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const timer = setTimeout(run, 1500);
  return () => clearTimeout(timer);
}

/**
 * Làm nóng trang QR khi khách chọn Chuyển khoản: tải sẵn mã của trang `/thanh-toan/chuyen-khoan/[code]` (mọi mã đơn dùng chung một bộ mã trang)
 * và mở sẵn kết nối tới máy chủ ảnh VietQR, để sau khi bấm Đặt hàng chỉ còn chờ đúng một lời gọi `/payments/bank-qr/:code`.
 */
export function warmBankPayment(prefetch: (href: string) => void): void {
  try {
    prefetch('/thanh-toan/chuyen-khoan/_');
  } catch {
    // Tải sẵn chỉ để nhanh hơn; hỏng thì trang vẫn tải lúc chuyển.
  }
  preconnect('https://img.vietqr.io', { crossOrigin: 'anonymous' });
}
